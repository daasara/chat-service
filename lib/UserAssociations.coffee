
Promise = require 'bluebird'
_ = require 'lodash'

{ asyncLimit } = require './utils.coffee'


# @private
# @nodoc
# @mixin
#
# Associations for User class.
UserAssociations =

  # @private
  userJoinRoomReport : (userName, roomName) ->
    @transport.sendToChannel roomName, 'roomUserJoined', roomName, userName

  # @private
  userLeftRoomReport : (userName, roomName) ->
    @transport.sendToChannel roomName, 'roomUserLeft', roomName, userName

  # @private
  userRemovedReport : (userName, roomName) ->
    echoChannel = @userState.makeEchoChannelName userName
    @transport.sendToChannel echoChannel, 'roomAccessRemoved', roomName
    @userLeftRoomReport userName, roomName

  # @private
  socketJoinEcho : (id, roomName, njoined) ->
    echoChannel = @userState.echoChannel
    @transport.sendToOthers id, echoChannel, 'roomJoinedEcho'
    , roomName, id, njoined

  # @private
  socketLeftEcho : (id, roomName, njoined) ->
    echoChannel = @userState.echoChannel
    @transport.sendToOthers id, echoChannel, 'roomLeftEcho'
    , roomName, id, njoined

  # @private
  socketConnectEcho : (id, nconnected) ->
    echoChannel = @userState.echoChannel
    @transport.sendToOthers id, echoChannel, 'socketConnectEcho', id, nconnected

  # @private
  socketDisconnectEcho : (id, nconnected) ->
    echoChannel = @userState.echoChannel
    @transport.sendToOthers id, echoChannel, 'socketDisconnectEcho', id
    , nconnected

  # @private
  leaveChannel : (id, channel) ->
    @transport.leaveChannel id, channel
    .catch (e) =>
      @consistencyFailure e, {roomName : channel, id, op : 'socketLeaveChannel'}

  # @private
  socketLeaveChannels : (id, channels) ->
    Promise.map channels, (channel) =>
      @leaveChannel id, channel
    , { concurrency : asyncLimit }

  # @private
  channelLeaveSockets : (channel, ids) ->
    Promise.map ids, (id) =>
      @leaveChannel id, channel
    , { concurrency : asyncLimit }

  # @private
  rollbackRoomJoin : (error, id, room) ->
    roomName = room.name
    @userState.removeSocketFromRoom id, roomName
    .then (njoined) =>
      unless njoined then room.leave @userName
    .catch (e) =>
      @consistencyFailure e, { roomName, id, op : 'rollbackRoomJoin' }

  # @private
  leaveRoom : (roomName) ->
    @state.getRoom roomName
    .then (room) =>
      room.leave @userName
    .catch (e) =>
      @consistencyFailure e, { roomName, op : 'UserLeaveRoom' }

  # @private
  joinSocketToRoom : (id, roomName) ->
    Promise.using @userState.lockToRoom(roomName, id), =>
      @state.getRoom roomName
      .then (room) =>
        room.join @userName
      .then =>
        @userState.addSocketToRoom id, roomName
        .then (njoined) =>
          @transport.joinChannel id, roomName
          .then =>
            if njoined == 1
              @userJoinRoomReport @userName, roomName
            @socketJoinEcho id, roomName, njoined
            njoined
        .catch (e) =>
          @rollbackRoomJoin e, id, room

  # @private
  leaveSocketFromRoom : (id, roomName) ->
    Promise.using @userState.lockToRoom(roomName, id), =>
      @userState.removeSocketFromRoom id, roomName
      .then (njoined) =>
        @leaveChannel id, roomName
        .then =>
          @socketLeftEcho id, roomName, njoined
          unless njoined
            @leaveRoom roomName
            .then =>
              @userLeftRoomReport @userName, roomName
              njoined
          else
            njoined

  # @private
  removeUserSocket : (id) ->
    @userState.removeSocket id
    .catch (e) =>
      @consistencyFailure e, { id, op : 'removeUserSocket' }

  # @private
  removeSocketFromServer : (id) ->
    @userState.setSocketDisconnecting id
    .then =>
      @removeUserSocket id
    .spread (roomsRemoved = [], joinedSockets = [], nconnected = 0) =>
      @socketLeaveChannels id, roomsRemoved
      .then =>
        for roomName, idx in roomsRemoved
          njoined = joinedSockets[idx]
          @socketLeftEcho id, roomName, njoined
          unless njoined then @userLeftRoomReport @userName, roomName
        @socketDisconnectEcho id, nconnected

  # @private
  removeFromRoom : (roomName) ->
    Promise.using @userState.lockToRoom(roomName), =>
      @userState.removeAllSocketsFromRoom roomName
      .then (removedSockets = []) =>
        @channelLeaveSockets roomName, removedSockets
        .then =>
          if removedSockets.length
            @userRemovedReport @userName, roomName
          @leaveRoom roomName

  # @private
  removeUserFromRoom : (userName, roomName, attempt = 1, maxAttempts = 2) ->
    @state.getUser userName
    .then (user) ->
      user.removeFromRoom roomName
    .catch =>
      if attempt < maxAttempts
        Promise.delay(@lockTTL).then =>
          @removeUserFromRoom userName, roomName, attempt+1, maxAttempts

  # @private
  removeRoomUsers : (roomName, userNames = []) ->
    Promise.map userNames, (userName) =>
      @removeUserFromRoom userName, roomName
    , { concurrency : asyncLimit }


module.exports = UserAssociations
