var Graphite = require('reliable-graphite');
var request = require('request');
require('dotenv').load({silent: true});

// Use all variables from .env or pass config file path to WATCHMEN_GRAPHITE_CONFIG
var config = (function () {
  if (process.env.WATCHMEN_GRAPHITE_CONFIG) {
    return require(process.env.WATCHMEN_GRAPHITE_CONFIG);
  }
  return {
    graphite_host: process.env.WATCHMEN_GRAPHITE_HOST,
    graphite_port: process.env.WATCHMEN_GRAPHITE_PORT,
    graphite_api: {
      url: process.env.WATCHMEN_GRAPHITE_API,
      user: process.env.WATCHMEN_GRAPHITE_API_USER,
      pass: process.env.WATCHMEN_GRAPHITE_API_PASS,
    },
    graphite_event: {
      failedCheck: process.env.WATCHMEN_GRAPHITE_EVENT_FAILEDCHECK || true,
      newOutage: process.env.WATCHMEN_GRAPHITE_EVENT_NEWOUTAGE || true,
      serviceBack: process.env.WATCHMEN_GRAPHITE_EVENT_SERVICEBACK || true,
      latencyWarning: process.env.WATCHMEN_GRAPHITE_EVENT_LATENCYWARNING || true,
    }
  };
})();
console.log(config);

var graphite = new Graphite(config.graphite_host, config.graphite_port);

/**
 * Filter service name before sending
 * @param {String} name
 */
function filterName (name) {
  return name.replace(/http(s)?|:|\/\//g, '').replace(/\/|\./g, '_');
}

/**
 * Send data to Graphite
 * @param {Object} service
 * @param {String} metric
 * @param value
 */
function sendData (service, metric, value) {
  try {
    graphite.push('watchmen.' + filterName(service.name) + '.' + metric, value);
  } catch (error) {
    console.error(error);
  }
}

/**
 * Send Graphite event
 * @param {Object} service
 * @param {Object} body
 */
function sendEvent (service, body) {
  var serviceName = filterName(service.name);
  var tags = body.tags.split(' ');

  body.tags = 'watchmen ' + serviceName;
  tags.forEach(function (tag) {
    body.tags += ' ' + tag + ' ' + serviceName + '_' + tag;
  });

  return request(
    {
      method: 'POST',
      uri: config.graphite_api.url + '/events/',
      body: body,
      auth: {
        user: config.graphite_api.user,
        pass: config.graphite_api.pass
      },
      json: true
    },
    function (error) {
      if (error) {
        console.error('Request error:', error);
      }
    }
  );
}

/**
 * Watchmen event handlers
 */
var eventHandlers = {

  onFailedCheck: function (service, data) {
    // Send failed check indication
    sendData(service, 'failedCheck', 1);

    if (config.graphite_event.failedCheck) {
      sendEvent(service, {
        what: 'FAILED CHECK',
        tags: 'failed',
        when: Math.round(new Date().getTime() / 1000),
        data: 'Service: ' + service.name + ' (' + service.url + '). ' +
        'Type: ' + service.pingServiceName + '. ' +
        'Error: ' + JSON.stringify(data.error)
      });
    }
  },

  onLatencyWarning: function (service, data) {
    // Send latency warning indication with elapsed time
    sendData(service, 'latencyWarning', data.elapsedTime);

    if (config.graphite_event.latencyWarning) {
      sendEvent(service, {
        what: 'LATENCY WARNING',
        tags: 'latency',
        when: Math.round(new Date().getTime() / 1000),
        data: 'Service: ' + service.name + ' (' + service.url + '). ' +
        'Type: ' + service.pingServiceName + '. ' +
        'Default: ' + service.warningThreshold + ' ms. ' +
        'Current: ' + data.elapsedTime + ' ms.'
      });
    }
  },

  onServiceOk: function (service, data) {
    // Send success check load time
    sendData(service, 'serviceOk', data.elapsedTime);
  },

  onNewOutage: function (service, outage) {
    // Send new outage indication
    sendData(service, 'newOutage', 1);

    if (config.graphite_event.newOutage) {
      sendEvent(service, {
        what: 'NEW OUTAGE',
        tags: 'outage',
        when: Math.round(outage.timestamp / 1000),
        data: 'Service: ' + service.name + ' (' + service.url + '). ' +
        'Type: ' + service.pingServiceName + '. ' +
        'Error: ' + JSON.stringify(outage.error)
      });
    }
  },

  onServiceBack: function (service, lastOutage) {
    // Send downtime duration in ms. (from latest outage)
    sendData(service, 'serviceBack', new Date().getTime() - lastOutage.timestamp);

    if (config.graphite_event.serviceBack) {
      var duration = Math.round((new Date().getTime() - lastOutage.timestamp) / 1000);
      sendEvent(service, {
        what: 'RECOVERY',
        tags: 'recovery',
        when: Math.round(new Date().getTime() / 1000),
        data: 'Service: ' + service.name + ' (' + service.url + '). ' +
        'Type: ' + service.pingServiceName + '. ' +
        'Error: ' + JSON.stringify(lastOutage.error) + '. ' +
        'Duration: ' + (duration / 60).toFixed(2) + ' min.'
      });
    }
  },
};

function GraphitePlugin (watchmen) {
  watchmen.on('service-error', eventHandlers.onFailedCheck);
  watchmen.on('service-ok', eventHandlers.onServiceOk);
  watchmen.on('service-back', eventHandlers.onServiceBack);
  watchmen.on('new-outage', eventHandlers.onNewOutage);
  watchmen.on('latency-warning', eventHandlers.onLatencyWarning);
}

exports = module.exports = GraphitePlugin;