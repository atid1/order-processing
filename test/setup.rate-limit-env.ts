process.env.MONGO_URI = process.env.MONGO_URI ?? 'mongodb://test:27017';
process.env.MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'test';
process.env.DELIVERY_BASE_URL = process.env.DELIVERY_BASE_URL ?? 'http://test:4000';
process.env.RATE_LIMIT_STORE_PROVIDER = process.env.RATE_LIMIT_STORE_PROVIDER ?? 'memory';
