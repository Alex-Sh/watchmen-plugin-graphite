var Graphite = require('reliable-graphite');
require('dotenv').load({silent: true});

console.log(process.env.WATCHMEN_GRAPHITE_HOST);
console.log(process.env.WATCHMEN_GRAPHITE_PORT);

const graphite = new Graphite(process.env.WATCHMEN_GRAPHITE_HOST, process.env.WATCHMEN_GRAPHITE_PORT, {
    socket_timeout: 300000,
    socket_reconnect_delay: 1000,
    queue_size_limit: 10000000,
    chunk_size: 200,
    logger: (severity, message) => console[severity](message)
})
;

function filterName (name) {
  return name.replace(/http(s)?|:|\/\//g, '').replace(/\/|\./g, '_');
}

var eventHandlers = {
  onFailedCheck: function (service, data) {
    graphite.push('monitor.uptime.' + filterName(service.name) + '.time', null);
    graphite.push('monitor.uptime.' + filterName(service.name) + '.status', 0);
  },

  onServiceOk: function (service, data) {
    graphite.push('monitor.uptime.' + filterName(service.name) + '.time', data.elapsedTime);
    graphite.push('monitor.uptime.' + filterName(service.name) + '.status', 1);
  }
};

function GraphitePlugin (watchmen) {
  watchmen.on('service-error', eventHandlers.onFailedCheck);
  watchmen.on('service-ok', eventHandlers.onServiceOk);
}

exports = module.exports = GraphitePlugin;