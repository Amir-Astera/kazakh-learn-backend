const { mongoose, Schema } = require('./shared');

const levelSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    orderNum: { type: Number, required: true, min: 1 },
  },
  {
    timestamps: true,
    collection: 'levels',
  }
);

levelSchema.index({ orderNum: 1 }, { unique: true });
levelSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.models.Level || mongoose.model('Level', levelSchema);
