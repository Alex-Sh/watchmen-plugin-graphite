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
    }
  };
})();
console.log(config);

var graphite = new Graphite(config.graphite_host, config.graphite_port);

/**
 * Filter service name before sending
 * @param name
 */
function filterName (name) {
  return name.replace(/http(s)?|:|\/\//g, '').replace(/\/|\./g, '_');
}

/**
 * Send Graphite event
 * @param body
 */
function sendEvent (body) {
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
    }
  );
}

/**
 * Watchmen event handlers
 */
var eventHandlers = {

  onFailedCheck: function (service, data) {
    // Send new outage indication with failureInterval in ms. for full downtime calculations
    graphite.push('watchmen.' + filterName(service.name) + '.failedCheck', service.failureInterval);
  },

  onServiceOk: function (service, data) {
    // Send success check load time
    graphite.push('watchmen.' + filterName(service.name) + '.serviceOk', data.elapsedTime);
  },

  onNewOutage: function (service, outage) {
    // Send new outage indication with real start date calculated from failureInterval and failuresToBeOutage
    var failuresToBeOutage = isNaN(service.failuresToBeOutage) ? 1 : service.failuresToBeOutage;
    graphite.push('watchmen.' + filterName(service.name) + '.newOutage', service.failureInterval * failuresToBeOutage);
    sendEvent({
      what: 'OUTAGE',
      tags: 'watchmen ' + service.name + ' outage',
      when: Math.round(outage.timestamp / 1000),
      data: 'Service: ' + service.name + ' (' + service.url + '). ' +
      'Type: ' + service.pingServiceName + '. ' +
      'Error: ' + JSON.stringify(outage.error)
    });
  },

  onServiceBack: function (service, lastOutage) {
    // Send downtime duration in ms. (from latest outage)
    graphite.push('watchmen.' + filterName(service.name) + '.serviceBack', new Date().getTime() - lastOutage.timestamp);

    var duration = Math.round((new Date().getTime() - lastOutage.timestamp) / 1000);
    var minutes = Math.floor(duration / 60) + ':' + (duration % 60 ? duration % 60 : '00');
    sendEvent({
      what: 'RECOVERY',
      tags: 'watchmen ' + service.name + ' recovery',
      when: Math.round(new Date().getTime() / 1000),
      data: 'Service: ' + service.name + ' (' + service.url + '). ' +
      'Type: ' + service.pingServiceName + '. ' +
      'Error: ' + JSON.stringify(lastOutage.error) + '. ' +
      'Duration: ' + minutes + ' min.'
    });
  },
};

function GraphitePlugin (watchmen) {
  watchmen.on('service-error', eventHandlers.onFailedCheck);
  watchmen.on('service-ok', eventHandlers.onServiceOk);
  watchmen.on('service-back', eventHandlers.onServiceBack);
  watchmen.on('new-outage', eventHandlers.onNewOutage);
}

exports = module.exports = GraphitePlugin;