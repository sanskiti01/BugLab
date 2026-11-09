const toPublicTestCase = (testCase) => {
  if (testCase.isHidden) {
    return {
      id: testCase.id,
      bugId: testCase.bugId,
      isHidden: true,
    };
  }

  return testCase;
};

module.exports = toPublicTestCase;
