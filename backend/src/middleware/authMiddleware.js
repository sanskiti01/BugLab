const jwt = require("jsonwebtoken");

const protect = (req, res, next) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error("JWT_SECRET is not configured");
    return res.status(500).json({
      message: "Authentication is not configured",
    });
  }

  const authHeader = req.headers.authorization;
  const bearerMatch =
    typeof authHeader === "string" &&
    authHeader.match(/^Bearer\s+([^\s]+)$/i);

  if (!bearerMatch) {
    return res.status(401).json({
      message: "Access denied. No token provided.",
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(bearerMatch[1], secret, {
      algorithms: ["HS256"],
    });
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token.",
    });
  }

  if (
    !decoded ||
    typeof decoded !== "object" ||
    !Number.isSafeInteger(decoded.id) ||
    decoded.id <= 0 ||
    typeof decoded.username !== "string" ||
    !decoded.username.trim() ||
    !["USER", "ADMIN"].includes(decoded.role)
  ) {
    return res.status(401).json({
      message: "Invalid or expired token.",
    });
  }

  req.user = {
    id: decoded.id,
    username: decoded.username,
    role: decoded.role,
  };

  next();
};

module.exports = protect;