const { mongoose, Schema } = require('./shared');

const userLessonProgressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    legacyUserId: { type: Number, index: true, sparse: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', default: null },
    legacyLessonId: { type: Number, index: true, sparse: true },
    completed: { type: Boolean, default: false },
    score: { type: Number, default: 0, min: 0, max: 100 },
    mistakes: { type: Number, default: 0, min: 0 },
    xpEarned: { type: Number, default: 0, min: 0 },
    timeSpent: { type: Number, default: 0, min: 0 },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'userLessonProgress',
  }
);

userLessonProgressSchema.index({ userId: 1, lessonId: 1 }, { unique: true });

module.exports = mongoose.models.UserLessonProgress || mongoose.model('UserLessonProgress', userLessonProgressSchema);
