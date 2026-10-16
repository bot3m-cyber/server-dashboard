'use strict';
// Ordner des Dashboards. Per Umgebungsvariable verlegbar (z. B. auf einem Server oder für Tests).
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DASHBOARD_DATA_DIR || path.join(APP_DIR, 'data'));
const SERVERS_DIR = path.resolve(process.env.DASHBOARD_SERVERS_DIR || path.join(APP_DIR, 'servers'));
const DEFAULT_SERVER_DIR = path.resolve(process.env.DASHBOARD_DEFAULT_SERVER_DIR || path.join(APP_DIR, 'server'));

module.exports = { APP_DIR, DATA_DIR, SERVERS_DIR, DEFAULT_SERVER_DIR };
