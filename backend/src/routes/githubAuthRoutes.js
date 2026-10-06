const express = require("express");
const jwt = require("jsonwebtoken");
const passport = require("../config/githubPassport");

const router = express.Router();

router.get(
  "/github",
  passport.authenticate("github", {
    scope: ["user:email"],
  })
);

router.get(
  "/github/callback",
  passport.authenticate("github", {
    session: false,
    failureRedirect: "/",
  }),
  (req, res) => {
    const token = jwt.sign(
      {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.json({
      message: "GitHub authentication successful",
      token,
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role,
        xp: req.user.xp,
        level: req.user.level,
        githubId: req.user.githubId,
      },
    });
  }
);

module.exports = router;