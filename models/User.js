const { mongoose, Schema } = require('./shared');

const userSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    googleId: { type: String, unique: true, sparse: true, default: null },
    passwordHash: { type: String, default: null },
    name: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: null },
    xp: { type: Number, default: 0, min: 0 },
    streak: { type: Number, default: 1, min: 0 },
    lastActivity: { type: Date, default: null },
    isAdmin: { type: Boolean, default: false },
    languagePair: { type: String, enum: ['ru-kz', 'en-kz'], default: 'ru-kz' },
    learningGoal: { type: String, enum: ['general', 'travel', 'study', 'work'], default: 'general' },
    proficiencyLevel: { type: String, enum: ['beginner', 'elementary', 'intermediate'], default: 'beginner' },
    onboardingCompleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

userSchema.index({ xp: -1 });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
