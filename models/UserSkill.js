const { mongoose, Schema } = require('./shared');

const userSkillSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    legacyUserId: { type: Number, index: true, sparse: true },
    skillName: { type: String, enum: ['vocabulary', 'grammar', 'listening', 'speaking'], required: true },
    progress: { type: Number, default: 0, min: 0, max: 100 },
  },
  {
    timestamps: true,
    collection: 'userSkills',
  }
);

userSkillSchema.index({ userId: 1, skillName: 1 }, { unique: true });

module.exports = mongoose.models.UserSkill || mongoose.model('UserSkill', userSkillSchema);
