/* jshint esversion: 6 */
'use strict';
const soajs = require('soajs');
const async = require('async');
const step = require('../functions/initialize.js');
const deactivate = require('../functions/deactivate.js');
const utils = require('../utils/utils');
const collection = {
  analytics: 'analytics',
};

let tracker = {};
const script = {
  checkAnalytics(opts, cb) {
    const settings = opts.settings;
    const env = opts.env;
    const date = new Date().getTime();
    const data = {};
    // return tracker ready
    let activated = false;
    if (settings && settings.env) {
      activated = utils.getActivatedEnv(settings, env);
    }
    if (settings && settings.env && settings.env[env]) {
      if (!(tracker[env] && tracker[env].info && tracker[env].info.status)) {
        tracker[env] = {
          info: {
            status: 'ready',
            ts: date,
          }
        };
        data[env] = true;
        data.tracker = tracker[env];
        data.activated = activated;
      } else {
        data.tracker = tracker[env];
        data[env] = true;
        data.activated = activated;
      }
    } else {
      data.tracker = tracker[env] || {};
      data[env] = false;
      data.activated = activated;
    }
    if (settings) {
      if (settings.kibana) {
        data.kibana = settings.kibana;
      }
      if (settings.elasticsearch) {
        data.elasticsearch = settings.elasticsearch;
      }
    }
    return cb(null, data);
  },
  
  initialize(opts, cb) {
    const data = {};
    const date = new Date().getTime();
    const mode = opts.mode;
    const env = opts.envRecord.environment.toLowerCase();
    
    if (mode === 'dashboard' && opts.analyticsSettings
      && opts.analyticsSettings.env && opts.analyticsSettings.env[env]) {
      tracker[env] = {
        info: {
          status: 'ready',
          ts: date,
        },
      };
      data[env] = true;
      data.tracker = tracker[env];
      return cb(null, data);
    }
    
    else if (mode === 'dashboard' && tracker[env]
      && tracker[env].info && tracker[env].info.status
      && tracker[env].info.status === 'started') {
      data.tracker = tracker[env] || {};
      data[env] = false;
      return cb(null, data);
    }
    
    tracker[env] = {
      info: {
        status: 'started',
        ts: date,
      },
    };
    function returnTracker() {
      if (mode === 'dashboard') {
        tracker[env] = {
          info: {
            status: 'started',
            ts: date,
          },
        };
        data.tracker = tracker[env];
        data[env] = false;
        return cb(null, data);
      }
    }
    
    returnTracker();
    const workFlowMethods = ["insertMongoData", "deployElastic", "pingElasticsearch", "getElasticClientNode",
      "setMapping", "addVisualizations", "deployKibana", "deployLogstash", "deployLogstash", "deployFilebeat",
      "deployMetricbeat", "checkAvailability", "setDefaultIndex"];
    let operations = [];
    utils.setEsCluster(opts, (errC, esConfig) => {
      if (errC) {
        tracker[env] = {
          "info": {
            "status": "failed",
            "date": new Date().getTime()
          }
        };
        return cb(errC);
      }
      tracker[env].counterPing = 0;
      tracker[env].counterInfo = 0;
      tracker[env].counterAvailability = 0;
      tracker[env].counterKibana = 0;
      opts.tracker = tracker;
      opts.esClient = new soajs.es(esConfig.esCluster);
      opts.esDbInfo = {
        esDbName: esConfig.esDbName,
        esClusterName: esConfig.esClusterName,
        esCluster: esConfig.esCluster
      };
    
      async.eachSeries(workFlowMethods, (methodName, cb) => {
        operations.push(async.apply(step[methodName], opts));
        return cb();
      }, () => {
        async.series(operations, (err) => {
          if (err){
            console.log("err: ", err)
            tracker[env] = {
              "info": {
                "status": "failed",
                "date": new Date().getTime()
              }
            };
          }
          tracker =  opts.tracker;
          if (mode === 'installer') {
            opts.esClient.close();
            return cb(err);
          }
          //todo check if this is needed
          // else {
          //   script.deactivateAnalytics(opts.soajs, opts.env, opts.model, function (err) {
          //     if (err) {
          //       opts.soajs.log.error(err);
          //     }
          //   });
          // }
          else {
            opts.esClient.close();
          }
          if (mode === 'dashboard') {
            opts.soajs.log.debug("Analytics deployed");
          }
        });
      });
      // async.auto(operations, (err, auto) => {
      //   if (err) {
      //
      //   }
      //   //todo check if this is needed
      //   else {
      //     script.deactivateAnalytics(opts.soajs, opts.env, opts.model, function (err) {
      //       if (err) {
      //         opts.soajs.log.error(err);
      //       }
      //     });
      //   }
      //   // close es connection
      //   if (opts.soajs.inputmaskData && opts.soajs.inputmaskData.elasticsearch === 'local') {
      //     auto.pingElasticsearch.close();
      //   }
      //   else {
      //     opts.esClient.close();
      //   }
      //   if (mode === 'dashboard') {
      //     opts.soajs.log.debug("Analytics deployed");
      //   }
      //   if (mode === 'installer') {
      //     return cb(null, true);
      //   }
      //   return null;
      // });
    });
  },
  
  deactivate(soajs, env, model, cb) {
    const combo = {};
    combo.collection = collection.analytics;
    combo.conditions = {
      _type: 'settings',
    };
    const environment = env.code.toLowerCase();
    model.findEntry(soajs, combo, (err, settings) => {
      if (err) {
        return cb(err);
      }
      const options = utils.buildDeployerOptions(env, soajs, model);
      const activated = utils.getActivatedEnv(settings, environment);
      deactivate.deleteService(options, environment, activated, (error) => {
        if (error) {
          return cb(error);
        }
        if (!settings) {
          tracker = {};
          return cb(null, true);
        }
        
        if (settings.env && settings.env[environment]) {
          settings.env[environment] = false;
        }
        
        if (settings.logstash && settings.logstash[environment]) {
          delete settings.logstash[environment];
        }
        
        if (settings.filebeat && settings.filebeat[environment]) {
          delete settings.filebeat[environment];
        }
        
        if (settings.metricbeat && !activated) {
          delete settings.metricbeat;
        }
        if (settings.kibana && !activated) {
          delete settings.kibana;
        }
        
        // save
        const comboS = {};
        comboS.collection = collection.analytics;
        comboS.record = settings;
        model.saveEntry(soajs, comboS, (error) => {
          if (error) {
            return cb(error);
          }
          tracker = {};
          return cb(null, true);
        });
      });
    });
  }
  
};

module.exports = script;
