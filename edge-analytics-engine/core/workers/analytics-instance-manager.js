const exec = require('child-process-promise').exec;
const Promise = require('bluebird');

const AnalyticsManifest = require('../models/analytics-manifest');
const dataSourceDiscoverer = require('./data-source-discoverer');
const errors = require('../common/errors');
const logger = require('../common/loggers').get('ANALYTICS-RUNTIME');
const modelDiscoverer = require('./model-discoverer');
const State = require('../models/state');

// The analytics instance table (AIT).
// The table maps analytics instance identification numbers (AIIDs) to analytics instance control
// blocks (AICBs).
const _ait = { };

// Starts the analytics processor with the given manifest that is part of tha analytics instance
// with the given AIID.
const _startAnalyticsProcessor = (aiid, analyticsProcessorManifest) => {
  const id = analyticsProcessorManifest._id;
  logger.debug(`Start analytics processor ${ id }.`);
  const dataSourceIds = analyticsProcessorManifest.dataSources.dataSource.map((ds) => {
    return ds.dataSourceManifestReferenceID;
  });
  const dataSinkId = analyticsProcessorManifest.dataSink.dataSourceManifestReferenceID;
  const analyticsProcessorDefinitionId =
    analyticsProcessorManifest.analyticsProcessorDefinitionReferenceID;
  return Promise.all([
    // Discover the data sources.
    Promise.map(dataSourceIds, (id) => {
      return dataSourceDiscoverer.discoverDataSources({ id });
    }),
    // Discover the data sink.
    dataSourceDiscoverer.discoverDataSources({ id: dataSinkId }),
    // Discover the analytics processor definition.
    modelDiscoverer.discoverAnalyticsProcessorDefinitions({
      id: analyticsProcessorDefinitionId
    })
  ]).spread((dataSources, dataSinks, analyticsProcessorDefinitions) => {
    // Some data source does not exist.
    if (dataSources.some((ds) => { ds.length === 0; })) {
      logger.error('One or more data sources do not exist.');
      throw new errors.BadRequestError('DATA_SOURCE_NOT_FOUND');
    }
    // The data sink does not exist.
    if (!dataSinks.length) {
      logger.error(`Data sink ${ dataSinkId } does not exist.`);
      throw new errors.BadRequestError('DATA_SINK_NOT_FOUND');
    }
    // The analytics processor definition does not exist.
    if (!analyticsProcessorDefinitions.length) {
      const apdId = analyticsProcessorDefinitionId;
      logger.error(`Analytics processor definition ${ apdId } does not exist.`);
      throw new errors.BadRequestError('ANALYTICS_PROCESSOR_DEFINITION_NOT_FOUND');
    }
    return {
      dataSources: dataSources.map((ds) => { return ds[0]; }),
      dataSink: dataSinks[0],
      analyticsProcessorDefinition: analyticsProcessorDefinitions[0]
    };
  }).then(({ dataSources, dataSink, analyticsProcessorDefinition }) => {
    // Put together the system properties.
    let properties = '';
    // Put the analytics processor ID to the system property faredge.processor.id.
    properties = `${ properties } -Dfaredge.processor.id=${ id }`;
    // Put the data sink ID to the system property faredge.sink.id.
    properties = `${ properties } -Dfaredge.sink.id=${ dataSinkId }`;
    // Put the the value for a parameter x that is passed to one of the data sources of the
    // analytics processor to the system property faredge.input.$.x, where $ is the index of the
    // data source.
    dataSources.forEach((ds, index) => {
      if (ds.dataSourceDefinitionInterfaceParameters &&
        ds.dataSourceDefinitionInterfaceParameters.parameter) {
        ds.dataSourceDefinitionInterfaceParameters.parameter.forEach((kv) => {
          properties = `${ properties } -Dfaredge.input.${ index }.${ kv.key }=${ kv.value }`;
        });
      }
    });
    // Put the value for a parameter x that is passed to the data sink of the analytics processor
    // to the system property faredge.output.x.
    if (dataSink.dataSourceDefinitionInterfaceParameters &&
      dataSink.dataSourceDefinitionInterfaceParameters.parameter) {
      dataSink.dataSourceDefinitionInterfaceParameters.parameter.forEach((kv) => {
        properties = `${ properties } -Dfaredge.output.${ kv.key }=${ kv.value }`;
      });
    }
    // Put the value for a parameter x that is passed to the analytics processor itself to the
    // system property faredge.x.
    if (analyticsProcessorManifest.parameters &&
      analyticsProcessorManifest.parameters.parameter) {
      analyticsProcessorManifest.parameters.parameter.forEach((kv) => {
        properties = `${ properties } -Dfaredge.${ kv.key }=${ kv.value }`;
      });
    }
    // Run the analytics processor.
    const command = `java -jar ${ properties } ${ analyticsProcessorDefinition.processorLocation }`;
    logger.debug(`Start analytics processor ${ id } with the command ${ command }.`);
    const p = exec(command).then(() => {
      logger.debug(`Analytics processor ${ id } stopped.`);
      // The processor stopped.
      _ait[aiid].processors[id].state = State.STOPPED;
      _ait[aiid].state = _ait[aiid].processors.some((p) => { return p.state === State.FAILED; }) ?
        State.FAILED : State.STOPPED;
    }).catch((error) => {
      logger.error(`Something went wrong with analytics processor ${ id }.`, error);
      _ait[aiid].processors[id].state = State.FAILED;
      _ait[aiid].state = State.FAILED;
    });
    _ait[aiid].processors[id].process = p.childProcess;
    _ait[aiid].processors[id].state = State.RUNNING;
    logger.debug(`Started analytics processor ${ id }.`);
    return { process: p.childProcess, state: State.RUNNING };
  }).catch((error) => {
    logger.error(`Failed to start analytics processor ${ id }.`, error);
    throw error;
  });
};

// Creates the analytics instance with the given AIID.
const createAnalyticsInstance = (aiid) => {
  logger.debug(`Create analytics instance ${ aiid }.`);
  return Promise.try(() => {
    // Create the AICB for the analytics instance with the given AIID.
    const aicb = { processors: [], state: State.STOPPED };
    // Put it into the AIT.
    _ait[aiid] = aicb;
    logger.debug(`Created analytics instance ${ aiid }.`);
    return null;
  }).catch((error) => {
    logger.error(`Failed to create analytics instance ${ aiid }.`, error);
    throw error;
  });
};

// Destroys the analytics instance with the given AIID.
const destroyAnalyticsInstance = (aiid) => {
  logger.debug(`Destroy analytics instance ${ aiid }.`);
  return Promise.try(() => {
    // Find the AICB for the analytics instance with the given AIID.
    const aicb = _ait[aiid];
    if (aicb) {
      // The analytics instance is running.
      if (aicb.state === State.RUNNING) {
        logger.error(`Analytics instance ${ aiid } is running.`);
        throw new errors.BadRequestError('ANALYTICS_INSTANCE_RUNNING');
      }
      // Remove the AICB from the AIT.
      delete _ait[aiid];
    } else {
      // There is no AICB for the given AIID.
      // Say it has been destroyed.
      logger.warn(`Analytics instance ${ aiid } has no AICB.`);
    }
    logger.debug(`Destroyed analytics instance ${ aiid }.`);
    return null;
  }).catch((error) => {
    logger.error(`Failed to destroy analytics instance ${ aiid }.`, error);
    throw error;
  });
};

// Gets the state of the analytics instance with the given AIID.
const getAnalyticsInstanceState = (aiid) => {
  logger.debug(`Gets state of analytics instance ${ aiid }.`);
  return Promise.try(() => {
    // Find the AICB for the analytics instance with the given AIID.
    const aicb = _ait[aiid];
    // There is no AICB for the given AIID.
    if (!aicb) {
      logger.error(`Analytics instance ${ aiid } has no AICB.`);
      throw new errors.NotFoundError('ANALYTICS_INSTANCE_NOT_FOUND');
    }
    logger.debug(`Got state of analytics instance ${ aiid }.`);
    return aicb.state;
  }).catch((error) => {
    logger.error(`Failed to get state of analytics instance ${ aiid }.`, error);
    throw error;
  });
};

// Initialises everything.
const init = () => {
  logger.info('Re-create all analytics instances.');
  return Promise.try(() => {
    // Find all analytics manifests.
    return AnalyticsManifest.find({});
  }).then((analyticsManifests) => {
    // Create an AICB for each one of them.
    return Promise.each(analyticsManifests, (am) => {
      logger.debug(`Re-create analytics instance ${ am._id }.`);
      _ait[am._id] = { processors: [], state: State.STOPPED };
    });
  }).then(() => {
    logger.info('Re-created all analytics instances.');
    return null;
  });
};

// Starts the analytics instance with the given AIID.
const startAnalyticsInstance = (aiid) => {
  logger.debug(`Start analytics instance ${ aiid }.`);
  // Find the AICB for the analytics instance with the given AIID.
  const aicb = _ait[aiid];
  return Promise.try(() => {
    // Find the analytics manifest with the given ID.
    return AnalyticsManifest.findById(aiid);
  }).then((analyticsManifest) => {
    // The analytics manifest does not exist.
    if (!analyticsManifest) {
      logger.error(`Analytics instance ${ aiid } does not exist.`);
      throw new errors.NotFoundError('ANALYTICS_INSTANCE_NOT_FOUND');
    }
    // There is no AICB for the given AIID.
    if (!aicb) {
      logger.error(`Analytics instance ${ aiid } has no AICB.`);
      throw new errors.NotFoundError('ANALYTICS_INSTANCE_NOT_FOUND');
    }
    // The analytics instance is running.
    if (aicb.state === State.RUNNING) {
      logger.error(`Analytics instance ${ aiid } is running.`);
      throw new errors.BadRequestError('ANALYTICS_INSTANCE_RUNNING');
    }
    aicb.processors = analyticsManifest.analyticsProcessors.apm.map((apm) => {
      return { apid: apm._id, process: null, state: State.STOPPED };
    });
    aicb.state = State.STOPPED;
    // Start all analytics processors.
    return Promise.each(analyticsManifest.analyticsProcessors.apm, (apm) => {
      return Promise.try(() => {
        return _startAnalyticsProcessor(aiid, apm);
      }).catch((error) => {
        logger.error(`Failed to start analytics processor ${ apm._id }.`, error);
        aicb.processors[apm._id] = {
          ...aicb.processors[apm._id],
          ...{
            state: State.FAILED,
            process: null
          }
        };
        return null;
      });
    });
  }).then(() => {
    // All analytics processors have started.
    if (aicb.processors.every((p) => { return p.state === State.RUNNING; })) {
      aicb.state = State.RUNNING;
      logger.debug(`Started analytics instance ${ aiid }.`);
      return null;
    }
    // Some of the analytics processors failed to start.
    logger.error(`Failed to start some analytics processors for analytics instance ${ aiid }`);
    // Stop the ones that started.
    return Promise.map(aicb.processors.filter((p) => {
      return p.state === State.RUNNING;
    }), (p) => {
      p.process.kill();
      return null;
    }).then(() => {
      aicb.processors = [];
      aicb.state = aicb.processors.some((p) => { return p.state === State.FAILED; }) ?
        State.FAILED : State.STOPPED;
      throw new Error(`Failed to start analytics instance ${ aiid }.`);
    });
  }).catch((error) => {
    logger.error(`Failed to start analytics instance ${ aiid }.`, error);
    throw error;
  });
};

// Stops the analytics instance with the given AIID.
const stopAnalyticsInstance = (aiid) => {
  logger.debug(`Stop analytics instance ${ aiid }.`);
  // Find the AICB for the analytics instance with the given AIID.
  const aicb = _ait[aiid];
  return Promise.try(() => {
    // There is no AICB for the given AIID.
    if (!aicb) {
      logger.error(`Analytics instance ${ aiid } has no AICB.`);
      throw new errors.NotFoundError('ANALYTICS_INSTANCE_NOT_FOUND');
    }
    // The analytics instance is not running.
    if (aicb.state !== State.RUNNING) {
      logger.error(`Analytics instance ${ aiid } is not running.`);
      throw new errors.BadRequestError('ANALYTICS_INSTANCE_NOT_RUNNING');
    }
    // Stop all processors.
    // NOTE: Do your best.
    return Promise.each(aicb.processors, (p) => {
      return Promise.try(() => {
        p.process.kill();
        return null;
      }).catch((error) => {
        logger.error(`Failed to stop analytics processor with PID ${ process.pid }.`, error);
        return null;
      });
    });
  }).then(() => {
    aicb.processors = [];
    aicb.state = State.STOPPED;
    logger.debug(`Stopped analytics instance ${ aiid }.`);
    return null;
  }).catch((error) => {
    logger.error(`Failed to stop analytics instance ${ aiid }.`, error);
    throw error;
  });
};

// Shuts everything down.
const shutDown = () => {
  logger.info('Stop all running analytics instances.');
  Object.keys(_ait).forEach((aiid) => {
    const aicb = _ait[aiid];
    if (aicb.state !== State.RUNNING) {
      return;
    }
    logger.debug(`Stop analytics instance ${ aiid }.`);
    aicb.processors.forEach((p) => {
      p.process.kill();
    });
  });
  logger.info('Stopped all running analytics instances.');
};

module.exports = {
  createAnalyticsInstance,
  destroyAnalyticsInstance,
  getAnalyticsInstanceState,
  init,
  shutDown,
  startAnalyticsInstance,
  stopAnalyticsInstance
};
