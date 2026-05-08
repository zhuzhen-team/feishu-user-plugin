// src/events/index.js — barrel import for the events subsystem.
const { EventBuffer, DEFAULT_CAP } = require('./event-buffer');
const { createWSServer } = require('./ws-server');
const owner = require('./owner');
const cursor = require('./cursor');
const log = require('./event-log');
const lockfile = require('./lockfile');

module.exports = {
  EventBuffer, DEFAULT_CAP, createWSServer,
  owner, cursor, log, lockfile,
};
