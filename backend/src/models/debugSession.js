const mongoose = require("mongoose");

const debugSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: Number,
      required: true,
      index: true,
    },

    bugId: {
      type: Number,
      required: true,
      index: true,
    },

    language: {
      type: String,
      required: true,
      trim: true,
    },

    codeSubmitted: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ["STARTED", "COMPLETED", "FAILED"],
      default: "STARTED",
    },

    timeSpent: {
      type: Number,
      default: 0,
      min: 0,
    },

    hintsUsed: {
      type: Number,
      default: 0,
      min: 0,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: "debug_sessions",
  }
);

module.exports = mongoose.model("DebugSession", debugSessionSchema);