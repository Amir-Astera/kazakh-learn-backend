const { mongoose, Schema, exerciseTypeValues } = require('./shared');

const exerciseSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
    type: { type: String, enum: exerciseTypeValues, required: true },
    question: { type: String, required: true },
    questionAudio: { type: String, default: null },
    options: { type: [String], default: null },
    correctAnswer: { type: String, required: true },
    explanation: { type: String, default: null },
    orderNum: { type: Number, required: true, min: 1 },
  },
  {
    timestamps: true,
    collection: 'exercises',
  }
);

exerciseSchema.index({ lessonId: 1, orderNum: 1 }, { unique: true });

module.exports = mongoose.models.Exercise || mongoose.model('Exercise', exerciseSchema);
