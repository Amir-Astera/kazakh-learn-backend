require('dotenv').config();

let cachedMongoose = null;

function getMongoose() {
  try {
    cachedMongoose = cachedMongoose || require('mongoose');
    return cachedMongoose;
  } catch (error) {
    error.message = 'MongoDB provider requested, but `mongoose` is not installed yet. Run `npm install mongoose` in the backend project.';
    throw error;
  }
}

async function connectMongo() {
  const mongoose = getMongoose();
  const mongoUri = String(process.env.MONGODB_URI || '').trim();

  if (!mongoUri) {
    throw new Error('MONGODB_URI is not set. Add it to your backend environment before starting with DB_PROVIDER=mongo.');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (mongoose.connection.readyState === 2) {
    return mongoose.connection.asPromise();
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  console.log('Connected to MongoDB');
  return mongoose.connection;
}

module.exports = {
  connectMongo,
  getMongoose,
};
