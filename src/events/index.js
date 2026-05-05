// src/events/index.js — barrel import for the events subsystem.
const { EventBuffer, DEFAULT_CAP } = require('./event-buffer');
const { createWSServer } = require('./ws-server');

module.exports = { EventBuffer, DEFAULT_CAP, createWSServer };
