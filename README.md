# jl-client

> XHR based client for json-lines streaming

# Installation
```
npm install git+ssh://git@github.houston.softwaregrp.net:andreas-weber/jl-client.git
```

# Usage
```
const jlClient = require('jl-client');

const requestConfig = {
    path: '/json-stream'
};

jlClient.connect(requestConfig)
    .then(server => { // connection established
        server.on('data', (data) => {
            console.log('new data from backend:', data);
        });
        server.on('disconnect', (error) => {
            if (error) {
                console.log('connection abort caused by error:', error);
            } else {
                console.log('connection abort caused by server');
            }
        });
        // ...
        server.disconnect();
    })
    .catch(error => { // connection failed
        console.log('connection establishment failed', error);
    });
```

# Reference
> required **parameters** are written bold  
> optional *parameters* are written italic or marked with `[`square brackets`]`  

## Methods

### jlClient.connect(requestConfig, [moduleConfig]): Promise
Creates XHR to start HTTP streaming based on request configuration.

| Param             | Type            | Sample                              | Description                       |
| ----------------- | --------------- | ----------------------------------- | --------------------------------- |
| **requestConfig** | `requestConfig` | `{ 'path': '/json-stream' }`        | definition for streaming request  |
| *moduleConfig*    | `moduleConfig`  | `{ 'connectionTimeoutInMS': 5000 }` | configuration of request handling |

**Resolves** with connected server instance (`.then(server => {...})`)  
**Rejects** in cases of a failed connection attempt (`.catch(error => {...})`)  


### server.on(eventName, eventHandler): void
Registers handler/callback functions for events (`data`, `disconnect`).  
Internally there are more events emitted (`heartbeat`, `responseLength`), but they are for administrative tasks only.

| Param            | Type       |
| ---------------- | ---------- |
| **eventName**    | `string`   |
| **eventHandler** | `function` |

| Event Name     | Handler Signature          | Description                                                                                                               |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| data           | `(data) => void`           | handler for incoming json objects (heartbeats are filtered out)                                                           |
| disconnect*    | `([error]) => void`        | callback for connection end; error is defined for unexpected aborts                                                       |
|                |
| heartbeat      | `() => void`               | handler for incoming heartbeats                                                                                           |
| responseLength | `(responseLength) => void` | notifies about current size of response buffer after each chunk processing                                                |

> *) executes just once

### server.removeListener(eventName, eventHandler): void
Removes listeners from prior event registration (`server.on(...)`).

| Param            | Type       |
| ---------------- | ---------- |
| **eventName**    | `string`   |
| **eventHandler** | `function` |

### server.isIdle(): boolean
Checks if any partial objects are waiting for incoming chunk to become a complete JSON object.

**Returns** if the response pointer is set on the end of all received data.

### server.disconnect(): void
Closes server connection.

## Custom Type Definitions

### `requestConfig` - Request Configuration

| Param     | Type      | Sample                                | Description                             |
| --------- | --------- | ------------------------------------- | --------------------------------------- |
| *ssl**    | `boolean` | `true`                                | indicator to use http or https          |
| *host**   | `string`  | `'my-domain.com'`                     | define domain of targeted host          |
| *port**   | `number`  | `443`                                 | define port on targeted host            |
| **path**  | `string`  | `'/json-stream'`                      | path to access json-lines provider      |
| *headers* | `object`  | `{ 'Authorization': 'Basic abc123' }` | map of http headers and their values    |
| *query*   | `object`  | `{ 'lastEvent': '1505077200' }`       | map of url query params and their value |
| *body*    | `object`  | `{ 'subjects': ['news','weather'] }`  | http body (json only)                   |
  
> *) as default `ssl`, `host`, `port` will be defined by current domain  

### `moduleConfig` - Module Configuration

| Param                   | Type        | Default        | Description                                                                     |
| ----------------------- | ----------- | -------------- | ------------------------------------------------------------------------------- |
| *connectionTimeoutInMS* | `number`    | `3000`         | time to wait before a connection attempt is evaluated as failed                 |
| *isAcknowledgeFilter*   | `function`* | `_isHeartbeat` | function to detect initial acknowledge message; uses first heartbeat by default |
| *filterAcknowledge*     | `boolean`   | `true`         | set false to receive acknowledge data through data event                        |

> *) `(dataPackage) => boolean`
