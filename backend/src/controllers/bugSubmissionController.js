const {
  SubmissionError,
  createCodeSubmission,
  getPublicSubmission,
  getPublicSubmissionByKey,
  toPublicSubmission,
} = require("../services/codeSubmissionService");

const ALLOWED_FIELDS = new Set([
  "submittedSolution",
  "hintsUsed",
  "timeSpent",
]);

const isJsonObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

const createBugSubmissionHandler = (prisma) => async (req, res) => {
  const bugId =
    typeof req.params.id === "string" && /^\d+$/.test(req.params.id)
      ? Number(req.params.id)
      : Number.NaN;

  if (!Number.isSafeInteger(bugId) || bugId <= 0) {
    return res.status(400).json({ message: "Invalid bug ID" });
  }
  if (!isJsonObject(req.body)) {
    return res.status(400).json({ message: "A JSON object is required" });
  }
  if (Object.keys(req.body).some((field) => !ALLOWED_FIELDS.has(field))) {
    return res.status(400).json({ message: "Unsupported submission field" });
  }

  try {
    const submission = await createCodeSubmission({
      prisma,
      userId: req.user.id,
      bugId,
      submittedSolution: req.body.submittedSolution,
      hintsUsed: req.body.hintsUsed === undefined ? 0 : req.body.hintsUsed,
      timeSpent: req.body.timeSpent === undefined ? 0 : req.body.timeSpent,
      idempotencyKey: req.get("Idempotency-Key"),
    });

    return res.status(202).json({
      submissionId: submission.id,
      status: submission.status,
      statusUrl: `/api/submissions/${submission.id}`,
    });
  } catch (error) {
    if (error instanceof SubmissionError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("Create code submission error", {
      errorName: error?.name || "Error",
    });
    return res.status(500).json({ message: "Server error" });
  }
};

const createSubmissionStatusHandlers = (prisma) => ({
  getById: async (req, res) => {
    try {
      const submission = await getPublicSubmission({
        prisma,
        userId: req.user.id,
        id: req.params.id,
      });
      return res.status(200).json(submission);
    } catch (error) {
      if (error instanceof SubmissionError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Get code submission status error", {
        errorName: error?.name || "Error",
      });
      return res.status(500).json({ message: "Server error" });
    }
  },
  getByKey: async (req, res) => {
    try {
      const submission = await getPublicSubmissionByKey({
        prisma,
        userId: req.user.id,
        idempotencyKey: req.params.key,
      });
      return res.status(200).json(submission);
    } catch (error) {
      if (error instanceof SubmissionError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Get submission by idempotency key error", {
        errorName: error?.name || "Error",
      });
      return res.status(500).json({ message: "Server error" });
    }
  },
});

module.exports = {
  createBugSubmissionHandler,
  createSubmissionStatusHandlers,
  toPublicSubmission,
};
