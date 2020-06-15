const { BaseRequestPolicy } = require("@azure/ms-rest-js");

module.exports = function timeoutPolicy(requestTimeout) {
    return {
        create: function (nextPolicy, options) {
            return new TimeoutPolicy(nextPolicy, options, requestTimeout);
        }
    };
}

var DEFAULT_CLIENT_REQUEST_TIMEOUT = 1000 * 10;

class TimeoutPolicy extends BaseRequestPolicy {
    constructor(nextPolicy, options, requestTimeout) {
        super(nextPolicy, options);

        function isNumber(n) { return typeof n === "number"; }
        
        this.requestTimeout = isNumber(requestTimeout) ? requestTimeout : DEFAULT_CLIENT_REQUEST_TIMEOUT;
    }

    sendRequest = function(request) {
        var _this = this;
        
        request.timeout = this.requestTimeout;

        return this._nextPolicy.sendRequest(request.clone())
            .catch(function(error) { 

                // If the request.timeout is reached, `timeout of ${ policy.requestTimeout }ms exceeded` will
                const errorIsTimeout = error && error.message && error.message.includes('timeout') && error.message.includes(`${ _this.requestTimeout }ms`);

                if(errorIsTimeout) {
                    error.status = 503; // mimic Service Unavailable, so exponentialRetryPolicy will retry
                }
                return error;
            });
    };
};