'use strict'

const ChatServiceError = require('./ChatServiceError')
const Promise = require('bluebird')
const _ = require('lodash')
const util = require('util')

let debuglog = util.debuglog('ChatService')

let asyncLimit = 32

let nameChecker = /^[^\u0000-\u001F:{}\u007F]+$/

function possiblyCallback (args) {
  let cb = _.last(args)
  if (_.isFunction(cb)) {
    args = _.slice(args, 0, -1)
  } else {
    cb = null
  }
  return [args, cb]
}

function checkNameSymbols (name) {
  if (_.isString(name) && nameChecker.test(name)) {
    return Promise.resolve()
  } else {
    return Promise.reject(new ChatServiceError('invalidName', name))
  }
}

function execHook (hook, ...args) {
  if (!hook) { return Promise.resolve() }
  let cb, callbackResults, hasResults
  let wrapper = function (...data) {
    hasResults = true
    callbackResults = data
    if (cb) { cb(...data) }
  }
  let res = hook(...args, wrapper)
  if (hasResults) {
    return Promise.fromCallback(
      fn => { fn(...callbackResults) },
      {multiArgs: true})
  } else if ((res != null) && typeof res.then === 'function') {
    return res
  } else {
    return Promise.fromCallback(fn => { cb = fn }, {multiArgs: true})
  }
}

function run (self, gen) {
  return Promise.coroutine(gen).call(self)
}

function logError (error) {
  let isServiceError = error instanceof ChatServiceError
  if (!isServiceError) {
    debuglog(error)
  }
  return Promise.reject(error)
}

// based on https://github.com/amercier/es6-mixin
function mixin (target, MixinConstructor, ...args) {
  let source = new MixinConstructor(...args)
  let names = Object.getOwnPropertyNames(MixinConstructor.prototype)
  for (let name of names) {
    let val = source[name]
    if (_.isFunction(val) && name !== 'constructor') {
      target[name] = val.bind(source)
    }
  }
}

function convertError (error, useRawErrorObjects) {
  if (error != null) {
    if (!useRawErrorObjects) {
      return error.toString()
    }
    let isServiceError = error instanceof ChatServiceError
    if (!isServiceError) {
      return new ChatServiceError('internalError', error.toString())
    }
  }
  return error
}

module.exports = {
  asyncLimit,
  checkNameSymbols,
  convertError,
  execHook,
  logError,
  mixin,
  possiblyCallback,
  run
}
