const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const bugRoutes = require("./routes/bugRoutes");
const bugAttemptRoutes = require("./routes/bugAttemptRoutes");
const bugTestCaseRoutes = require("./routes/bugTestCaseRoutes");

const app = express();

// Middleware FIRST
app.use(cors());
app.use(express.json());

// Routes AFTER middleware
app.use("/api/auth", authRoutes);
app.use("/api/bugs", bugRoutes);
app.use("/api/bugs", bugAttemptRoutes);
app.use("/api/bugs", bugTestCaseRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "BugLab API is running",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`BugLab server running on port ${PORT}`);
});