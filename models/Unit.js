const { mongoose, Schema, pointSchema, landmarkSchema } = require('./shared');

const unitSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    title: { type: String, required: true, trim: true },
    titleKz: { type: String, required: true, trim: true },
    subtitle: { type: String, default: '' },
    icon: { type: String, default: 'book' },
    orderNum: { type: Number, required: true, min: 1 },
    lessonCount: { type: Number, default: 0, min: 0 },
    pathImageUrl: { type: String, default: null },
    pathPoints: { type: [pointSchema], default: [] },
    landmarkPosition: { type: pointSchema, default: null },
    landmarks: { type: [landmarkSchema], default: [] },
  },
  {
    timestamps: true,
    collection: 'units',
  }
);

unitSchema.index({ moduleId: 1, orderNum: 1 }, { unique: true });

module.exports = mongoose.models.Unit || mongoose.model('Unit', unitSchema);
