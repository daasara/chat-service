
if (process.env.TEST_ES6) {
  // require('babel-register')({presets: ['es2015']})
  console.log('es6 testing...');
  var ChatService = require('../src-es6/ChatService');
} else {
  var ChatService = require('../src/ChatService.coffee');
}
import Promise from 'bluebird';
import Redis from 'ioredis';
import _ from 'lodash';
import config from './config.coffee';
import io from 'socket.io-client';


let makeURL = function(port) {
  port = port || config.port;
  return `${config.host}:${port}${config.namespace}`;
};

let makeParams = function(userName) {
  let params = {
    query : `user=${userName}`,
    multiplex : false,
    reconnection : false,
    transports : [ 'websocket' ]
  };
  if (!userName) {
    delete params.query;
  }
  return params;
};


let state = null;
let setState = s => state = s;

let customCleanup = null;
let setCustomCleanup = fn => customCleanup = fn;


let clientConnect = function(name, port) {
  let url = makeURL(port);
  let params = makeParams(name);
  return io.connect(url, params);
};

let startService = function(opts, hooks) {
  let options = { port : config.port };
  _.assign(options, state);
  _.assign(options, opts);
  return new ChatService(options, hooks);
};


if (process.env.TEST_REDIS_CLUSTER) {
  var redis = new Redis.Cluster(config.redisClusterConnect);
  var checkDB = done =>
    Promise.map(redis.nodes('master'), node =>
      node.dbsize().then(function(data) {
        if (data) { throw new Error('Unclean Redis DB'); }
      })
    
    )
    .asCallback(done)
  ;
  var cleanDB = () =>
    Promise.map(redis.nodes('master'), node => node.flushall()
    )
  ;
} else {
  var redis = new Redis(config.redisConnect);
  var checkDB = done =>
    redis.dbsize().then(function(data) {
      if (data) { throw new Error('Unclean Redis DB'); }
    })
    .asCallback(done)
  ;
  var cleanDB = () => redis.flushall();
}


let closeInstance = function(service) {
  if (!service) { return; }
  return service.close()
  .timeout(2000)
  .catch(function(e) {
    console.log('Service closing error: ', e);
    return Promise.try(() => service.redis && service.redis.disconnect())
    .catchReturn()
    .then(() =>
      Promise.fromCallback(cb => service.io.httpServer.close(cb))
    )
    .catchReturn();
  });
};

let cleanup = function(services, sockets, done) {
  services = _.castArray(services);
  sockets = _.castArray(sockets);
  return Promise.try(function() {
    for (let i = 0; i < sockets.length; i++) {
      let socket = sockets[i];
      socket && socket.disconnect();
    }
    if (customCleanup) {
      return Promise.fromCallback(customCleanup);
    } else {
      return Promise.map(services, closeInstance);
    }
  })
  .finally(function() {
    customCleanup = null;
    return cleanDB();
  })
  .asCallback(done);
};

// fix for node 0.12
let nextTick = (fn, ...args) => process.nextTick(() => fn(...args));

let parallel = (fns, cb) => Promise.map(fns, Promise.fromCallback).asCallback(cb);

let series = (fns, cb) => Promise.mapSeries(fns, Promise.fromCallback).asCallback(cb);


export { ChatService, checkDB, cleanup, clientConnect, closeInstance, nextTick, parallel, series, setCustomCleanup, setState, startService };
