const bcrypt = require("bcryptjs");

const registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({
        message: "Username, email and password are required",
      });
    }

    // Temporary response
    // Database connection will be added after PostgreSQL is ready
    const hashedPassword = await bcrypt.hash(password, 10);

    res.status(201).json({
      message: "Registration data received",
      user: {
        username,
        email,
        passwordHash: hashedPassword,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};

module.exports = {
  registerUser,
};