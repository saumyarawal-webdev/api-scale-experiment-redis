const express = require('express');
const mongoose = require('mongoose');
const { createClient } = require('redis');

const app = express();
app.use(express.json());

// 1. Connect to MongoDB & Redis
mongoose.connect('mongodb://localhost:27017/scale_db')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const redisClient = createClient({ url: 'redis://localhost:6379' });
redisClient.on('error', err => console.error('Redis Client Error', err));
redisClient.connect().then(() => console.log('Connected to Redis'));

// 2. Define a Schema
const WorkLogSchema = new mongoose.Schema({
  employeeId: String,
  taskTitle: String,
  durationMinutes: Number,
  tags: [String],
  createdAt: { type: Date, default: Date.now }
});
const WorkLog = mongoose.model('WorkLog', WorkLogSchema);

// 3. Helper Endpoint to Seed Mock Data
app.post('/api/seed', async (req, res) => {
  try {
    await WorkLog.deleteMany({}); // clear old data
    const mockLogs = [];
    const tagsArr = [['ui', 'bug'], ['backend', 'feature'], ['devops', 'ci-cd'], ['docs']];
    
    // Insert 50,000 records to create a realistic database weight
    for (let i = 0; i < 50000; i++) {
      mockLogs.push({
        employeeId: `emp-${Math.floor(Math.random() * 100)}`,
        taskTitle: `Task details and logs description number ${i}`,
        durationMinutes: Math.floor(Math.random() * 480) + 10,
        tags: tagsArr[i % tagsArr.length]
      });
    }
    await WorkLog.insertMany(mockLogs);
    res.send({ message: 'Successfully seeded 50,000 work logs!' });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// A Map to store ongoing database requests so we don't duplicate them
const pendingRequests = new Map();

// Unoptimized

// Endpoint 1: Complex Aggregation (Heavy CPU/Disk)
app.get('/api/analytics/heavy', async (req, res) => {
  try {
    // Simulates a heavy analytical query an admin would run
    const stats = await WorkLog.aggregate([
      { $match: { durationMinutes: { $gte: 60 } } },
      { $unwind: '$tags' },
      { $group: { 
          _id: '$tags', 
          totalMinutes: { $sum: '$durationMinutes' },
          avgMinutes: { $avg: '$durationMinutes' },
          count: { $sum: 1 } 
        } 
      },
      { $sort: { totalMinutes: -1 } }
    ]);
    res.json(stats);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Cache Stampede (Thundering Herd).
// Optimized Endpoint 1: Complex Aggregation with Redis Cache
// app.get('/api/analytics/heavy', async (req, res) => {
//   const cacheKey = 'analytics:heavy:stats';

//   try {
//     // 1. Check if the data exists in Redis
//     const cachedData = await redisClient.get(cacheKey);

//     if (cachedData) {
//       console.log('=== CACHE HIT (Redis) ===');
//       // Redis stores everything as strings, so we parse it back to JSON
//       return res.json(JSON.parse(cachedData));
//     }

//     console.log('=== CACHE MISS (MongoDB Compute) ===');
//     // 2. If not in cache, run the heavy MongoDB aggregation pipeline
//     const stats = await WorkLog.aggregate([
//       { $match: { durationMinutes: { $gte: 60 } } },
//       { $unwind: '$tags' },
//       { $group: { 
//           _id: '$tags', 
//           totalMinutes: { $sum: '$durationMinutes' },
//           avgMinutes: { $avg: '$durationMinutes' },
//           count: { $sum: 1 } 
//         } 
//       },
//       { $sort: { totalMinutes: -1 } }
//     ]);

//     // 3. Store the freshly calculated math in Redis 
//     // EX: 60 sets a Time-To-Live (TTL) of 60 seconds so it auto-expires
//     await redisClient.set(cacheKey, JSON.stringify(stats), {
//       EX: 60 
//     });

//     // 4. Return the response to the user
//     res.json(stats);

//   } catch (error) {
//     res.status(500).send(error.message);
//   }
// });

// Optimized Endpoint 1: Redis Cache + Promise Deduping (Anti-Stampede)
// app.get('/api/analytics/heavy', async (req, res) => {
//   const cacheKey = 'analytics:heavy:stats';

//   try {
//     // 1. Check Redis First
//     const cachedData = await redisClient.get(cacheKey);
//     if (cachedData) {
//       console.log('=== CACHE HIT (Redis) ===');
//       return res.json(JSON.parse(cachedData));
//     }

//     // 2. CHECK THE LOCK: Is someone else already doing the math?
//     if (pendingRequests.has(cacheKey)) {
//       console.log('=== CACHE LOCKED: Waiting for existing MongoDB compute... ===');
//       // Wait for the FIRST request to finish its promise, then grab that exact result
//       const sharedResult = await pendingRequests.get(cacheKey);
//       return res.json(sharedResult);
//     }

//     console.log('=== CACHE MISS (MongoDB Compute) - LOCKING CACHE ===');
    
//     // 3. CREATE THE PROMISE: Do the heavy lifting, but wrap it in a variable
//     const mongoPromise = WorkLog.aggregate([
//       { $match: { durationMinutes: { $gte: 60 } } },
//       { $unwind: '$tags' },
//       { $group: { 
//           _id: '$tags', 
//           totalMinutes: { $sum: '$durationMinutes' },
//           avgMinutes: { $avg: '$durationMinutes' },
//           count: { $sum: 1 } 
//         } 
//       },
//       { $sort: { totalMinutes: -1 } }
//     ]).then(async (stats) => {
//       // Once math is done, save to Redis for 60 seconds
//       await redisClient.set(cacheKey, JSON.stringify(stats), { EX: 60 });
//       // Remove the lock so future requests know it's done
//       pendingRequests.delete(cacheKey);
//       return stats;
//     });

//     // 4. SET THE LOCK: Put the promise in the Map so other requests can see it
//     pendingRequests.set(cacheKey, mongoPromise);

//     // 5. Await the result for this very first request and send it
//     const stats = await mongoPromise;
//     res.json(stats);

//   } catch (error) {
//     // If it fails, make sure we clear the lock so it doesn't stay stuck forever
//     pendingRequests.delete(cacheKey);
//     res.status(500).send(error.message);
//   }
// });

// Endpoint 2: Standard Fetching (Frequent read traffic)
app.get('/api/logs/:employeeId', async (req, res) => {
  try {
    const logs = await WorkLog.find({ employeeId: req.params.employeeId }).limit(100);
    res.json(logs);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));