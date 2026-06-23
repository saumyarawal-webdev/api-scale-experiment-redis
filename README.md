# Project Title

Redis Cache Stampede and Promise Deduping Experiment

## Project Overview

This repository contains a practical load-testing experiment that demonstrates how to protect a Node.js and MongoDB backend from a Thundering Herd (Cache Stampede) scenario. It compares an unoptimized database query against an optimized architecture using a Redis Cache-Aside pattern and in-memory Promise Deduping.

## Technologies Used

- Node.js and Express for the backend server
- MongoDB (via Docker) as the primary database
- Redis (via Docker) as the caching layer
- Autocannon for concurrent load testing

## The Problem (Thundering Herd)

When 100 concurrent users request a heavy MongoDB aggregation pipeline at the exact same moment, an empty cache causes all 100 requests to hit the database simultaneously. This crashes the database CPU, resulting in connection timeouts and zero completed requests per second.

## The Solution

To prevent the database crash, we implemented Promise Deduping. A memory map tracks ongoing requests. The first request locks the operation and hits the database. The other 99 concurrent requests detect the lock and await the existing promise. Once the math is done, the result is saved to Redis, and all 100 users receive the payload instantly without overloading MongoDB.

## Setup Instructions

- First, spin up the isolated database network by running the docker compose up command in the background.
- Next, initialize the Node environment and install the required dependencies: express, mongoose, and redis.
- Start the application server.
- Finally, populate the database with test data by sending a POST request to the local seed endpoint to insert 50,000 mock work logs.

## Running the Load Test

- Ensure the Autocannon CLI is installed globally on your machine.
- Run the load test command targeting the heavy analytics endpoint with 100 concurrent connections for 10 seconds.
- The exact command to run is:

```bash
autocannon -c 100 -d 10 http://localhost:3000/api/analytics/heavy
```

## Expected Benchmark Results

- In the unoptimized state, expect an average latency of around 9,000 milliseconds, less than 1 request per second, and a near 100 percent timeout error rate.
- In the optimized state, expect an average latency of roughly 170 milliseconds, over 500 requests per second, and zero timeout errors.
