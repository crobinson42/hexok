// Measures list queries at 100k records. Not part of CI.
// Build first, then run: MONGO_URL=mongodb://127.0.0.1:27018 node bench/list-100k.mjs
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { accessStages, MongoPathStore } from '../dist/index.js';

const RECORDS = 100_000;
const LOCATIONS = 1_000;

const client = await MongoClient.connect(process.env.MONGO_URL);
const db = client.db(`authz_bench_${randomUUID().slice(0, 8)}`);

function median(values) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

try {
  const store = new MongoPathStore({ db });
  await store.start();
  const scans = db.collection('scans');
  await scans.createIndex({ locationId: 1, updatedAt: -1 });

  const rows = [];
  const paths = [];
  for (let n = 0; n < RECORDS; n += 1) {
    const _id = new ObjectId();
    const location = `loc:${n % LOCATIONS}`;
    const region = `region:${(n % LOCATIONS) % 10}`;
    rows.push({ _id, locationId: location, updatedAt: new Date(n) });
    paths.push({
      _id: `scan:${n}`,
      orgId: 'org:a',
      path: ['org:a', region, location, `scan:${n}`],
      parents: [location],
      resourceId: _id,
    });
    if (rows.length === 5_000) {
      await scans.insertMany(rows.splice(0));
      await db.collection('authz_paths').insertMany(paths.splice(0));
    }
  }

  const west = {
    orgIds: ['org:a'],
    allow: [['region:1'], ['loc:2'], ['loc:3', 'scan:3']],
    deny: [['loc:11']],
  };
  const cases = {
    'one location, 100 rows, no access stages': [
      { $match: { locationId: 'loc:1' } },
      { $sort: { updatedAt: -1 } },
    ],
    'one location, 100 rows': [
      { $match: { locationId: 'loc:1' } },
      ...accessStages(west),
      { $sort: { updatedAt: -1 } },
    ],
    'whole organization, first 50 by date': [
      { $sort: { updatedAt: -1 } },
      ...accessStages(west),
      { $limit: 50 },
    ],
    'whole organization, every match': [...accessStages(west)],
  };

  for (const [name, pipeline] of Object.entries(cases)) {
    const times = [];
    let count = 0;
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      count = (await scans.aggregate(pipeline).toArray()).length;
      times.push(performance.now() - started);
    }
    console.log(
      `${name}: ${count} rows, median ${median(times).toFixed(1)} ms`,
    );
  }

  const plan = await scans
    .aggregate(cases['one location, 100 rows'])
    .explain('executionStats');
  const lookup = plan.stages?.find((stage) => stage.$lookup);
  console.log(
    `lookup: indexesUsed=${JSON.stringify(lookup?.indexesUsed)} docsExamined=${lookup?.totalDocsExamined}`,
  );
} finally {
  await db.dropDatabase();
  await client.close();
}
