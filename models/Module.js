const { mongoose, Schema } = require('./shared');

const moduleSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true },
    levelId: { type: Schema.Types.ObjectId, ref: 'Level', required: true },
    title: { type: String, required: true, trim: true },
    titleKz: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    orderNum: { type: Number, required: true, min: 1 },
    requiredXp: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    collection: 'modules',
  }
);

moduleSchema.index({ levelId: 1, orderNum: 1 }, { unique: true });
moduleSchema.index({ requiredXp: 1 });

module.exports = mongoose.models.Module || mongoose.model('Module', moduleSchema);
