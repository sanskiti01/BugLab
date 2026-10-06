const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectMongoDB = require("./config/mongo");
const passport = require("./config/githubPassport");

const authRoutes = require("./routes/authRoutes");
const githubAuthRoutes = require("./routes/githubAuthRoutes");
const bugRoutes = require("./routes/bugRoutes");
const bugAttemptRoutes = require("./routes/bugAttemptRoutes");
const bugTestCaseRoutes = require("./routes/bugTestCaseRoutes");
const debugSessionRoutes = require("./routes/debugSessionRoutes");

const apiRateLimiter = require("./middleware/rateLimitMiddleware");

const app = express();

app.use(cors());
app.use(express.json());
app.use(passport.initialize());
app.use(apiRateLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/auth", githubAuthRoutes);

app.use("/api/bugs", bugAttemptRoutes);
app.use("/api/bugs", bugRoutes);
app.use("/api/bugs", bugTestCaseRoutes);

app.use("/api/debug-sessions", debugSessionRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "BugLab API is running",
  });
});

const PORT = process.env.PORT || 5000;

connectMongoDB();

app.listen(PORT, () => {
  console.log(`BugLab server running on port ${PORT}`);
});