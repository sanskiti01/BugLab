const DebugSession = require("../models/debugSession");

const createDebugSession = async (req, res) => {
  try {
    const {
      userId,
      bugId,
      language,
      codeSubmitted,
    } = req.body;

    const session = await DebugSession.create({
      userId,
      bugId,
      language,
      codeSubmitted,
    });

    return res.status(201).json({
      message: "Debug session created successfully",
      session,
    });
  } catch (error) {
    console.error("Create debug session error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};



const getDebugSessions = async (req, res) => {
  try {
    const sessions = await DebugSession.find()
      .sort({ createdAt: -1 });

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

const updateDebugSession = async (req, res) => {
  try {
    const { id } = req.params;

    const session = await DebugSession.findByIdAndUpdate(
      id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
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

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const deleteDebugSession = async (req, res) => {
  try {
    const { id } = req.params;

    const session = await DebugSession.findByIdAndDelete(id);

    if (!session) {
      return res.status(404).json({
        message: "Debug session not found",
      });
    }

    return res.status(200).json({
      message: "Debug session deleted successfully",
      session,
    });
  } catch (error) {
    console.error("Delete debug session error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};
module.exports = {
  createDebugSession,
  getDebugSessions,
  updateDebugSession,
  deleteDebugSession,
};