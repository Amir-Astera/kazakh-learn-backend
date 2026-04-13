const { mongoose, Schema, lessonTypeValues } = require('./shared');

const lessonSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', required: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: lessonTypeValues, required: true },
    xpReward: { type: Number, default: 10, min: 0 },
    content: { type: String, default: null },
    orderNum: { type: Number, required: true, min: 1 },
  },
  {
    timestamps: true,
    collection: 'lessons',
  }
);

lessonSchema.index({ unitId: 1, orderNum: 1 }, { unique: true });
lessonSchema.index({ type: 1 });

module.exports = mongoose.models.Lesson || mongoose.model('Lesson', lessonSchema);
