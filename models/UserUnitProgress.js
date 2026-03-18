const { mongoose, Schema } = require('./shared');

const userUnitProgressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    legacyUserId: { type: Number, index: true, sparse: true },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', default: null },
    legacyUnitId: { type: Number, index: true, sparse: true },
    status: { type: String, enum: ['locked', 'current', 'completed'], default: 'locked' },
    completedLessons: { type: Number, default: 0, min: 0 },
    stars: { type: Number, default: 0, min: 0, max: 3 },
  },
  {
    timestamps: true,
    collection: 'userUnitProgress',
  }
);

userUnitProgressSchema.index({ userId: 1, unitId: 1 }, { unique: true });

module.exports = mongoose.models.UserUnitProgress || mongoose.model('UserUnitProgress', userUnitProgressSchema);
