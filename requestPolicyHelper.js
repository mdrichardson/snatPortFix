const { deserializationPolicy, exponentialRetryPolicy, systemErrorRetryPolicy, signingPolicy, userAgentPolicy } = require("@azure/ms-rest-js");
const  timeoutPolicy  = require('./TimeoutPolicy');

module.exports = function createRequestPolicyFactories(credentials, options) {
    const factories = [];
    if(options === undefined) {
        options = [];
    }
  
    if (options.generateClientRequestIdHeader) {
        factories.push(generateClientRequestIdPolicy(options.clientRequestIdHeaderName));
    }
    if (credentials) {
        factories.push(signingPolicy(credentials));
    }

    factories.push(userAgentPolicy({ value: options.userAgent }));
    
    if (!options.noRetryPolicy) {
        //retryCount, retryInterval, minRetryInterval, maxRetryInterval
        factories.push(exponentialRetryPolicy(options.retryCount, options.retryInterval, options.minRetryInterval, options.maxRetryInterval));
        // timeout per call, in seconds
        factories.push(timeoutPolicy(options.requestTimeout));
        
        factories.push(systemErrorRetryPolicy());
    }
    factories.push(deserializationPolicy(options.deserializationContentTypes));
    return factories;
}