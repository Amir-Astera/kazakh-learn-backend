const { mongoose, Schema } = require('./shared');

const userQuestSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    legacyUserId: { type: Number, index: true, sparse: true },
    questName: { type: String, required: true, trim: true },
    questType: { type: String, required: true, trim: true },
    target: { type: Number, required: true, min: 1 },
    current: { type: Number, default: 0, min: 0 },
    xpReward: { type: Number, default: 0, min: 0 },
    completed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'userQuests',
  }
);

userQuestSchema.index({ userId: 1, completed: 1, createdAt: -1 });

module.exports = mongoose.models.UserQuest || mongoose.model('UserQuest', userQuestSchema);
