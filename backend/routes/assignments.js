const router = require('express').Router();
const { respondToAssignment, AssignmentResponseError } = require('../services/assignmentResponses');

router.post('/respond', async (req, res) => {
  try {
    const result = await respondToAssignment(req.body || {});
    res.json(result);
  } catch (error) {
    if (error instanceof AssignmentResponseError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Unable to record assignment response:', error.name);
    res.status(500).json({ message: 'Unable to record assignment response. Please try again later.' });
  }
});

module.exports = router;
