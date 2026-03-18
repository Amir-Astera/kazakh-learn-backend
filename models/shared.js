const { getMongoose } = require('../config/mongo');

const mongoose = getMongoose();
const { Schema } = mongoose;

const lessonTypeValues = ['translation', 'choice', 'grammar', 'sentence', 'listening', 'speaking'];
const exerciseTypeValues = ['translation', 'choice', 'grammar', 'sentence', 'listening', 'speaking'];

const pointSchema = new Schema(
  {
    x: { type: Number, min: 0, max: 1, required: true },
    y: { type: Number, min: 0, max: 1, required: true },
  },
  { _id: false }
);

const landmarkSchema = new Schema(
  {
    imageUrl: { type: String, required: true, trim: true },
    altText: { type: String, required: true, trim: true },
    position: { type: pointSchema, default: null },
    legacyId: { type: Number, unique: true, sparse: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

module.exports = {
  mongoose,
  Schema,
  pointSchema,
  landmarkSchema,
  lessonTypeValues,
  exerciseTypeValues,
};
