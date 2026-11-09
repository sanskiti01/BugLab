
const mongoose = require("mongoose");
const DebugSession = require("../models/debugSession");

const VALID_STATUSES = ["STARTED", "COMPLETED", "FAILED"];
const VALID_EVENT_TYPES = ["HINT_USED", "CODE_SUBMITTED", "TEST_RUN"];
const ALLOWED_UPDATE_FIELDS = new Set([
  "codeSubmitted",
  "status",
  "timeSpent",
  "hintsUsed",
  "events",
  "completedAt",
]);

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const areValidEvents = (events) =>
  Array.isArray(events) &&
  events.every(
    (event) =>
      isPlainObject(event) &&
      Object.keys(event).every((key) => ["type", "timestamp"].includes(key)) &&
      VALID_EVENT_TYPES.includes(event.type) &&
      (event.timestamp === undefined ||
        (typeof event.timestamp === "string" &&
          !Number.isNaN(Date.parse(event.timestamp))))
  );

const createDebugSession = async (req, res) => {
  try {
    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        message: "A JSON object is required",
      });
    }

    const { bugId, language, codeSubmitted, events } = req.body;

    // Never trust a userId supplied by the client.
    const parsedBugId =
      typeof bugId === "number"
        ? bugId
        : typeof bugId === "string" && /^\d+$/.test(bugId)
          ? Number(bugId)
          : Number.NaN;

    if (
      !Number.isSafeInteger(parsedBugId) ||
      parsedBugId <= 0 ||
      typeof language !== "string" ||
      !language.trim() ||
      typeof codeSubmitted !== "string" ||
      !codeSubmitted.trim()
    ) {
      return res.status(400).json({
        message: "Valid bugId, language, and codeSubmitted are required",
      });
    }

    if (events !== undefined && !areValidEvents(events)) {
      return res.status(400).json({
        message: "Events must contain valid event objects",
      });
    }

    const session = await DebugSession.create({
      userId: req.user.id,
      bugId: parsedBugId,
      language: language.trim(),
      codeSubmitted,
      ...(events !== undefined && { events }),
    });

    return res.status(201).json({
      message: "Debug session created successfully",
      session,
    });
  } catch (error) {
    console.error("Create debug session error:", error);

    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({
        message: "Invalid debug session data",
      });
    }

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const getDebugSessions = async (req, res) => {
  try {
    const sessions = await DebugSession.find({
      userId: req.user.id,
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    console.error("Get debug sessions error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const getDebugSession = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid debug session ID",
      });
    }

    const session = await DebugSession.findOne({
      _id: id,
      userId: req.user.id,
    });

    if (!session) {
      return res.status(404).json({
        message: "Debug session not found",
      });
    }

    return res.status(200).json({ session });
  } catch (error) {
    console.error("Get debug session error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const updateDebugSession = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid debug session ID",
      });
    }

    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        message: "A JSON object is required",
      });
    }

    const updates = {};
    const requestFields = Object.keys(req.body);

    if (requestFields.some((field) => !ALLOWED_UPDATE_FIELDS.has(field))) {
      return res.status(400).json({
        message: "Unsupported update field",
      });
    }

    for (const field of requestFields) {
      updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "No valid fields provided for update",
      });
    }

    if (
      updates.status !== undefined &&
      !VALID_STATUSES.includes(updates.status)
    ) {
      return res.status(400).json({
        message: "Invalid session status",
      });
    }

    if (
      updates.codeSubmitted !== undefined &&
      (typeof updates.codeSubmitted !== "string" ||
        !updates.codeSubmitted.trim())
    ) {
      return res.status(400).json({
        message: "codeSubmitted must be a non-empty string",
      });
    }

    for (const field of ["timeSpent", "hintsUsed"]) {
      if (
        updates[field] !== undefined &&
        (!Number.isFinite(updates[field]) || updates[field] < 0)
      ) {
        return res.status(400).json({
          message: `${field} must be a non-negative number`,
        });
      }
    }

    if (
      updates.events !== undefined &&
      !areValidEvents(updates.events)
    ) {
      return res.status(400).json({
        message: "Events must contain valid event objects",
      });
    }

    if (updates.completedAt !== undefined) {
      if (
        updates.completedAt !== null &&
        (typeof updates.completedAt !== "string" ||
          Number.isNaN(Date.parse(updates.completedAt)))
      ) {
        return res.status(400).json({
          message: "completedAt must be a valid date or null",
        });
      }

      if (updates.completedAt !== null) {
        updates.completedAt = new Date(updates.completedAt);
      }
    }

    const session = await DebugSession.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!session) {
      return res.status(404).json({
        message: "Debug session not found",
      });
    }

    return res.status(200).json({
      message: "Debug session updated successfully",
      session,
    });
  } catch (error) {
    console.error("Update debug session error:", error);

    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({
        message: "Invalid debug session data",
      });
    }

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const deleteDebugSession = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid debug session ID",
      });
    }

    const session = await DebugSession.findOneAndDelete({
      _id: id,
      userId: req.user.id,
    });

    if (!session) {
      return res.status(404).json({
        message: "Debug session not found",
      });
    }

    return res.status(200).json({
      message: "Debug session deleted successfully",
    });
  } catch (error) {
    console.error("Delete debug session error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const getDebugSessionStats = async (req, res) => {
  try {
    const stats = await DebugSession.aggregate([
      { $match: { userId: req.user.id } },
      {
        $group: {
          _id: "$status",
          totalSessions: { $sum: 1 },
        },
      },
      { $sort: { totalSessions: -1 } },
    ]);

    return res.status(200).json({ stats });
  } catch (error) {
    console.error("Get debug session stats error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const getDebugSessionIndexStats = async (req, res) => {
  try {
    const stats = await DebugSession.find({
      userId: req.user.id,
    }).explain("executionStats");

    return res.status(200).json({ stats });
  } catch (error) {
    console.error("Get debug session index stats error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

module.exports = {
  createDebugSession,
  getDebugSessions,
  getDebugSession,
  updateDebugSession,
  deleteDebugSession,
  getDebugSessionStats,
  getDebugSessionIndexStats,
};
