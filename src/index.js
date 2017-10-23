'use strict';

require('native-promise-only');
const EventEmitter = require('event-emitter');

/* -------------- */
/* --- Helper --- */
/* -------------- */

const _isHeartbeat = dataPackage => dataPackage.name && dataPackage.name === 'heartbeat'; // eslint-disable-line arrow-body-style

/* -------------------------------- */
/* --- Configuration Management --- */
/* -------------------------------- */

const _buildUrl = requestConfig => {
  if (typeof requestConfig.path !== 'string') {
    throw new Error(`Parameter Error: requestConfig.path is required and has to be a string`);
  }
  let url = requestConfig.path;

  if (typeof requestConfig.query === 'object') {
    const queryArray = [];

    for (const queryKey in requestConfig.query) {
      if (requestConfig.query.hasOwnProperty(queryKey)) {
        queryArray.push(`${queryKey}=${requestConfig.query[queryKey]}`);
      }
    }

    url = `${url}?${queryArray.join('&')}`;
  }

  if (typeof requestConfig.ssl === 'boolean' && typeof requestConfig.host === 'string' && typeof requestConfig.port === 'number') {
    url = `${requestConfig.ssl ? 'https' : 'http'}://${requestConfig.host}:${requestConfig.port}${url}`;
  }

  return url;
};

const _preprocessRequestConfig = requestConfig => {
  if (typeof requestConfig !== 'object') {
    throw new Error('Missing Parameter: requestConfig is required');
  }

  requestConfig.url = _buildUrl(requestConfig);
  requestConfig.body = typeof requestConfig.body === 'object' ? requestConfig.body : undefined;
};

const _preprocessModuleConfig = moduleConfig => {
  moduleConfig.connectionTimeoutInMS = typeof moduleConfig.connectionTimeoutInMS === 'number' ? moduleConfig.connectionTimeoutInMS : 3000;
  moduleConfig.isAcknowledgeFilter = typeof moduleConfig.isAcknowledgeFilter === 'function' ? moduleConfig.isAcknowledgeFilter : _isHeartbeat;
  moduleConfig.filterAcknowledge = typeof moduleConfig.filterAcknowledge === 'boolean' ? moduleConfig.filterAcknowledge : true;
};

/* --------------------------------- */
/* --- Main - Connection Control --- */
/* --------------------------------- */

const JlClient = function(requestConfig, moduleConfig) {
  this._config = {
    request: requestConfig,
    module: moduleConfig || {}
  };
  this._state = {
    connected: false,
    responsePointer: 0
  };

  this._xhr = new XMLHttpRequest(); // eslint-disable-line no-undef
  this._server = new EventEmitter();
};

JlClient.prototype.connect = function() {
  return new Promise((resolve, reject) => {
    this._callbacks = {
      onConnectError: error => {
        if (!this._state.connected) {
          this._disconnect();
          reject(error);
        }
      },
      onConnectSuccess: () => {
        this._state.connected = true;

        /* eslint-disable arrow-body-style */
        this._server.isIdle = () => this._isIdle();
        this._server.disconnect = () => this._disconnect();
        /* eslint-enable arrow-body-style */
        resolve(this._server);
      }
    };

    try {
      _preprocessRequestConfig(this._config.request);
      _preprocessModuleConfig(this._config.module);
    } catch (error) {
      return this._callbacks.onConnectError(error);
    }

    this._setReadyStateChangeListener();
    this._xhr.open('POST', this._config.request.url, true);
    this._setHeaders();
    this._xhr.send(this._config.request.body ? JSON.stringify(this._config.request.body) : undefined);

    this._timeoutInspector = setTimeout(() => {
      this._timeoutInspector = undefined;
      if (typeof this._xhr.readyState !== 'number' || this._xhr.readyState < 2 || !this._state.connected) {
        this._callbacks.onConnectError(new Error('request-timeout'));
      }
    }, this._config.module.connectionTimeoutInMS);
  });
};

JlClient.prototype._disconnect = function() {
  this._state.connected = false;
  this._xhr.abort();
  if (this._timeoutInspector) {
    clearTimeout(this._timeoutInspector);
    this._timeoutInspector = undefined;
  }
};

JlClient.prototype._isIdle = function() {
  return this._state.responsePointer === this._xhr.response.length;
};

/* ------------------------------ */
/* --- Connection Preparation --- */
/* ------------------------------ */

JlClient.prototype._setHeaders = function() {
  if (typeof this._config.request.headers === 'object') {
    for (const headerName in this._config.request.headers) {
      if (this._config.request.headers.hasOwnProperty(headerName)) {
        this._xhr.setRequestHeader(headerName, this._config.request.headers[headerName]);
      }
    }
  }
  this._xhr.setRequestHeader('content-type', 'application/json');
};

JlClient.prototype._setReadyStateChangeListener = function() {
  this._xhr.onreadystatechange = () => {
    switch (this._xhr.readyState) {
      case 2:
        this._handleHeadersReceived(this._xhr.status);
        break;
      case 3:
        this._handleLoading(this._xhr.status, this._xhr.response);
        break;
      case 4:
        this._handleDone(this._xhr.status);
        break;
      default:
    }
  };
};

/* --------------------------- */
/* --- Connection Handling --- */
/* --------------------------- */

JlClient.prototype._handleHeadersReceived = function(statusCode) {
  if (statusCode !== 200) {
    this._callbacks.onConnectError(new Error('http-error'));
  }
};

JlClient.prototype._handleLoading = function(statusCode, response) {
  if ((statusCode !== 200) || (typeof response !== 'string') || (this._state.responsePointer >= response.length)) {
    return;
  }

  try {
    const dataChunk = response.substring(this._state.responsePointer, response.length - 1);
    const dataStrings = dataChunk.split('\n');

    for (let processingIndex = 0; processingIndex < dataStrings.length; processingIndex++) {
      const dataPackage = JSON.parse(dataStrings[processingIndex]);

      this._handleDataPackage(dataPackage);
      this._state.responsePointer += dataStrings[processingIndex].length + 1;
    }
  } catch (error) { } // eslint-disable-line no-empty

  this._server.emit('responseLength', this._xhr.response.length);
};

JlClient.prototype._handleDone = function(statusCode) {
  if (statusCode === 200) {
    if (!this._state.connected) {
      return this._callbacks.onConnectError(new Error('request-rejected'));
    }
    this._server.emit('disconnect');
  } else {
    if (!this._state.connected) {
      return; // client side disconnect
    }
    this._server.emit('disconnect', new Error(statusCode !== 0 ? 'http-abort' : 'network-error' + statusCode));
  }
  this._disconnect();
};

/* --------------------- */
/* --- Data Handling --- */
/* --------------------- */

JlClient.prototype._handleDataPackage = function(dataPackage) {
  if (typeof dataPackage === 'object') {
    if (!this._state.connected) {
      if (!this._config.module.isAcknowledgeFilter(dataPackage)) {
        return;
      }
      this._callbacks.onConnectSuccess();
      if (this._config.module.filterAcknowledge) {
        return;
      }
    }

    if (_isHeartbeat(dataPackage)) {
      this._server.emit('heartbeat');
    } else {
      this._server.emit('data', dataPackage);
    }
  }
};

/* -------------- */
/* --- Export --- */
/* -------------- */

module.exports = {
  connect: (requestConfig, moduleConfig) => {
    return (new JlClient(requestConfig, moduleConfig)).connect();
  }
};
