const _ = require('lodash');

const Database = use('Database');
const forEach = require('co-foreach');

const CompanySurveyQuestion = use('App/Model/CompanySurveyQuestion');

class SurveyQuestionsController {
  * list (request, response) {
    const user = request.currentUser;
    const company = yield user.company().fetch();

    // Ensure user has related company
    if (!company) {
      return response.badRequest('User must have a related company');
    }

    yield company.related('surveyQuestions.questionDefinition').load();

    // Get the survey questions that this company is using
    const questions = company
      .toJSON()
      .surveyQuestions
      .map(q =>
        _.merge(
          (_.pick(q.questionDefinition, ['title', 'question', 'code'])),
          (_.pick(q, ['priority']))
        )
      );

    return response.json({
      ok: true,
      result: { surveyQuestions: _.orderBy(questions, 'priority') }
    });
  }

  * get (request, response) {
    const user = request.currentUser;
    const company = yield user.company().fetch();

    // Ensure user has related company
    if (!company) {
      return response.badRequest('User must have a related company');
    }

    yield company.related('surveyQuestions.questionDefinition').load();

    // Get the survey questions that this company is using
    const surveyQuestions = company
      .toJSON()
      .surveyQuestions
      .map(q =>
        _.merge(
          (_.pick(q.questionDefinition, ['question'])),
          (_.pick(q, ['survey_question_id', 'priority']))
        )
      );

    // Get list of all available questions, excluding ones already selected
    const selectedQuestions = yield Database
      .from('company_survey_question')
      .where('company_id', company.id)
      .pluck('survey_question_id');

    const availableQuestions = yield Database
      .select('id as survey_question_id', 'question')
      .from('survey_questions')
      .whereNotIn('id', selectedQuestions)
      .orderBy('id', 'asc');

    return response.json({
      ok: true,
      result: {
        availableQuestions,
        selectedQuestions: _.orderBy(surveyQuestions, 'priority') }
    });
  }

  * edit (request, response) {
    const user = request.currentUser;
    const company = yield user.company().fetch();
    const questionsList = request.input('questionsList');

    // Make sure input is a number
    const validInput = questionsList.every((question) => {
      if (typeof question.survey_question_id !== 'number' || typeof question.priority !== 'number') {
        return false;
      }
      return true;
    });

    if (!validInput) {
      return response.status(400).json({
        ok: false,
        message: {
          title: 'Invalid question or priority',
          message: 'Make sure you provide a valid question and priority.'
        }
      });
    }

    // Make sure priority is not negative
    const validPriority = questionsList.every((question) => {
      if (question.priority < 0) {
        return false;
      }
      return true;
    });

    if (!validPriority) {
      return response.status(400).json({
        ok: false,
        message: {
          title: 'Invalid priority',
          message: 'Make sure you provide a valid question priority.'
        }
      });
    }

    // Make sure question exists
    const allQuestions = yield Database
      .from('survey_questions')
      .pluck('id');

    const questionExists = questionsList.every((question) => {
      if (!_.includes(allQuestions, question.survey_question_id)) {
        return false;
      }
      return true;
    });

    if (!questionExists) {
      return response.status(400).json({
        ok: false,
        message: {
          title: 'Question does not exist',
          message: 'Make sure you provide a valid question.'
        }
      });
    }

    // Make sure no duplicate questions
    let questionIDArray = [];
    questionsList.every(question =>
      questionIDArray.push(question.survey_question_id)
    );
    questionIDArray = _.uniq(questionIDArray);

    if (questionIDArray.length !== questionsList.length) {
      return response.status(400).json({
        ok: false,
        message: {
          title: 'Duplicate question',
          message: 'Make sure all survey questions are unique.'
        }
      });
    }

    // Get company's survey question primary keys
    const companyQuestions = yield Database
      .from('company_survey_question')
      .where('company_id', company.id)
      .pluck('id');

    // Make sure number of question primary keys matches number of questions provided
    if (companyQuestions.length !== questionsList.length) {
      return response.status(400).json({
        ok: false,
        message: {
          title: 'Invalid number of questions',
          message: 'Make sure you provide the required number of questions.'
        }
      });
    }

    // Check if questions list provided contains questions that did not change
    // If yes, separate these primary keys from the available keys
    // Use the remaining keys to set the new questions (old questions keep their original keys)
    // This is necessary to avoid violating unique question constraint during save operation
    const currentQuestions = yield Database
      .select('id', 'survey_question_id')
      .from('company_survey_question')
      .where('company_id', company.id);

    let availablePKs = _.clone(currentQuestions);

    forEach(questionsList, (question, i) => {
      const index = _.findIndex(currentQuestions, ['survey_question_id', question.survey_question_id]);
      if (index >= 0) {
        availablePKs[index] = null;
        questionsList[i].id = currentQuestions[index].id;
      } else {
        questionsList[i].id = null;
      }
    });

    availablePKs = _.compact(availablePKs);
    let i = 0;
    forEach(questionsList, (question) => {
      if (question.id === null) {
        question.id = availablePKs[i].id;
        i++;
      }
    });

    // Use each question primary key to save each question's id and priority
    yield forEach(questionsList, function * (item) {
      const companyQuestionID = item.id;
      const questionID = item.survey_question_id;
      const priority = item.priority;

      // Save the new company survey question
      const question = yield CompanySurveyQuestion.findBy('id', companyQuestionID);
      question.survey_question_id = questionID;
      question.priority = priority;
      yield question.save();
    });

    // Get the survey questions that this company is using
    yield company.related('surveyQuestions.questionDefinition').load();

    const surveyQuestions = company
      .toJSON()
      .surveyQuestions
      .map(q =>
        _.merge(
          (_.pick(q.questionDefinition, ['question'])),
          (_.pick(q, ['survey_question_id', 'priority']))
        )
      );

    // Get list of all available questions, excluding ones already selected
    const selectedQuestions = yield Database
      .from('company_survey_question')
      .where('company_id', company.id)
      .pluck('survey_question_id');

    const availableQuestions = yield Database
      .select('id as survey_question_id', 'question')
      .from('survey_questions')
      .whereNotIn('id', selectedQuestions)
      .orderBy('id', 'asc');

    let message = 'Changed survey question.';
    if (availablePKs.length === 0) message = 'Changed question priority.';

    return response.json({
      ok: true,
      message: {
        title: 'Success',
        message
      },
      result: {
        availableQuestions,
        selectedQuestions: _.orderBy(surveyQuestions, 'priority') }
    });
  }
}

module.exports = SurveyQuestionsController;