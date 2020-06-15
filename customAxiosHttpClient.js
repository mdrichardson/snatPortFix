// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

const Transform = require('stream');
const { RestError, HttpHeaders } = require('@azure/ms-rest-js');
const axios = require('axios');
var http = require('http');
var https = require('https');

const axiosInstance = axios.create({
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true })
});

// This hack is still required with 0.19.0 version of axios since axios tries to merge the
// Content-Type header from it's config["<method name>"] where the method name is lower-case,
// into the request header. It could be possible that the Content-Type header is not present
// in the original request and this would create problems while creating the signature for
// storage data plane sdks.
axiosInstance.interceptors.request.use((config) => ({
    ...config,
    method: config.method && (config.method).toUpperCase()
}));

/**
 * A HttpClient implementation that uses axios to send HTTP requests.
 */
class CustomAxiosHttpClient {
    async sendRequest(httpRequest) {
        if (typeof httpRequest !== 'object') {
            throw new Error('httpRequest (WebResource) cannot be null or undefined and must be of type object.');
        }

        const abortSignal = httpRequest.abortSignal;
        if (abortSignal && abortSignal.aborted) {
            throw new RestError('The request was aborted', RestError.REQUEST_ABORTED_ERROR, undefined, httpRequest);
        }

        let abortListener;
        const cancelToken = abortSignal && new axios.CancelToken(canceler => {
            abortListener = () => canceler();
            abortSignal.addEventListener('abort', abortListener);
        });

        const rawHeaders = httpRequest.headers.rawHeaders();

        const httpRequestBody = httpRequest.body;
        let axiosBody =
        // Workaround for https://github.com/axios/axios/issues/755
        // tslint:disable-next-line:no-null-keyword
        typeof httpRequestBody === 'undefined' ? null
            : typeof httpRequestBody === 'function' ? httpRequestBody()
                : httpRequestBody;

        const onUploadProgress = httpRequest.onUploadProgress;
        if (onUploadProgress && axiosBody) {
            let loadedBytes = 0;
            const uploadReportStream = new Transform({
                transform: (chunk, _encoding, callback) => {
                    loadedBytes += chunk.length;
                    onUploadProgress({ loadedBytes });
                    callback(undefined, chunk);
                }
            });
            if (isReadableStream(axiosBody)) {
                axiosBody.pipe(uploadReportStream);
            } else {
                uploadReportStream.end(axiosBody);
            }
            axiosBody = uploadReportStream;
        }

        let res;
        try {
            const config = {
                method: httpRequest.method,
                url: httpRequest.url,
                headers: rawHeaders,
                data: axiosBody,
                transformResponse: (data) => { return data; },
                validateStatus: () => true,
                // Workaround for https://github.com/axios/axios/issues/1362
                maxContentLength: Infinity,
                responseType: httpRequest.streamResponseBody ? 'stream' : 'text',
                cancelToken,
                timeout: httpRequest.timeout,
                proxy: false
            };
            res = await axiosInstance.request(config);
        } catch (err) {
            if (err instanceof axios.Cancel) {
                throw new RestError(err.message, RestError.REQUEST_SEND_ERROR, undefined, httpRequest);
            } else {
                const axiosErr = err;
                throw new RestError(axiosErr.message, RestError.REQUEST_SEND_ERROR, undefined, httpRequest);
            }
        } finally {
            if (abortSignal && abortListener) {
                abortSignal.removeEventListener('abort', abortListener);
            }
        }

        const headers = new HttpHeaders(res.headers);

        const onDownloadProgress = httpRequest.onDownloadProgress;
        let responseBody = res.data;
        if (onDownloadProgress) {
            if (isReadableStream(responseBody)) {
                let loadedBytes = 0;
                const downloadReportStream = new Transform({
                    transform: (chunk, _encoding, callback) => {
                        loadedBytes += chunk.length;
                        onDownloadProgress({ loadedBytes });
                        callback(undefined, chunk);
                    }
                });
                responseBody.pipe(downloadReportStream);
                responseBody = downloadReportStream;
            } else {
                const length = parseInt(headers.get('Content-Length')) || (responseBody).length || undefined;
                if (length) {
                    // Calling callback for non-stream response for consistency with browser
                    onDownloadProgress({ loadedBytes: length });
                }
            }
        }

        const operationResponse = {
            request: httpRequest,
            status: res.status,
            headers,
            readableStreamBody: httpRequest.streamResponseBody ? responseBody : undefined,
            bodyAsText: httpRequest.streamResponseBody ? undefined : responseBody
        };

        return operationResponse;
    }
}

function isReadableStream(body) {
    return typeof body.pipe === 'function';
}

exports.CustomAxiosHttpClient = CustomAxiosHttpClient;
