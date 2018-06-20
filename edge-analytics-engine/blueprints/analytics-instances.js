const State = require('../core/models/state');
const validations = require('../core/common/validations');

const _parameter = validations.object().keys({
  key: validations.string().required(),
  value: validations.any().required()
});

const _dataSource = validations.object().keys({
  dataSourceManifestReferenceID: validations.id().required()
});

const _processor = validations.object().keys({
  analyticsProcessorDefinitionReferenceID: validations.id().required(),
  parameters: validations.object().keys({
    parameter: validations.array().items(_parameter).required()
  }).optional(),
  dataSources: validations.object().keys({
    dataSource: validations.array().items(_dataSource).required()
  }).required(),
  dataSink: _dataSource
});

// How to create an analytics instance.
const createAnalyticsInstance = {
  body: {
    edgeGatewayReferenceID: validations.string().allow('').allow(null).optional(),
    analyticsProcessors: validations.object().keys({
      apm: validations.array().items(_processor).required()
    }).required()
  }
};

// How to destroy an analytics instance.
const destroyAnalyticsInstance = {
  params: {
    id: validations.id().required()
  }
};

// How to discover analytics instances.
const discoverAnalyticsInstances = {
  body: {
    id: validations.id().allow('').allow(null).optional(),
    state: validations.string().valid(State.ALL).allow('').allow(null).optional()
  }
};

// How to get an analytics instance.
const getAnalyticsInstance = {
  params: {
    id: validations.id().required()
  }
};

// How to get the specification of an analytics instance.
const getAnalyticsInstanceSpecification = {
  params: {
    id: validations.id().required()
  }
};

// How to get the state of an analytics instance.
const getAnalyticsInstanceState = {
  params: {
    id: validations.id().required()
  }
};

// How to start an analytics instance.
const startAnalyticsInstance = {
  params: {
    id: validations.id().required()
  }
};

// How to stop an analytics instance.
const stopAnalyticsInstance = {
  params: {
    id: validations.id().required()
  }
};

// How to update the specification of an analytics instance.
const updateAnalyticsInstanceSpecification = {
  params: {
    id: validations.id().required()
  },
  body: {
    edgeGatewayReferenceID: validations.string().allow('').allow(null).optional(),
    analyticsProcessors: validations.object().keys({
      apm: validations.array().items(_processor).required()
    }).required()
  }
};

module.exports = {
  createAnalyticsInstance,
  destroyAnalyticsInstance,
  discoverAnalyticsInstances,
  getAnalyticsInstance,
  getAnalyticsInstanceSpecification,
  getAnalyticsInstanceState,
  startAnalyticsInstance,
  stopAnalyticsInstance,
  updateAnalyticsInstanceSpecification
};
