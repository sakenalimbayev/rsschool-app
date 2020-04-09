import Router from '@koa/router';
import { BAD_REQUEST, OK } from 'http-status-codes';
import { ILogger } from '../../logger';
import { IUserSession } from '../../models';
import { CrossCheckService, StudentService } from '../../services';
import { setErrorResponse, setResponse } from '../utils';
import { validateGithubIdAndAccess, validateGithubId } from '../validators';
import { courseGuard } from '../guards';

export function addCrossCheckRoutes(router: Router, logger: ILogger) {
  const validators = [validateGithubIdAndAccess];
  const baseUrl = `/student/:githubId/task/:courseTaskId/cross-check`;

  router.post(`${baseUrl}/solution`, courseGuard, ...validators, createSolution(logger));
  router.get(`${baseUrl}/solution`, courseGuard, ...validators, getSolution(logger));
  router.post(`${baseUrl}/result`, courseGuard, validateGithubId, createResult(logger));
  router.get(`${baseUrl}/result`, courseGuard, validateGithubId, getResult(logger));
  router.get(`${baseUrl}/feedback`, courseGuard, ...validators, getFeedback(logger));
  router.get(`${baseUrl}/assignments`, courseGuard, ...validators, getAssignments(logger));
}

const createSolution = (_: ILogger) => async (ctx: Router.RouterContext) => {
  const { githubId, courseId, courseTaskId } = ctx.params;
  const { url } = ctx.request.body as { url: string };
  const crossCheckService = new CrossCheckService(courseTaskId);
  const isValid = await crossCheckService.isValidTask();
  const student = await new StudentService(courseId, githubId).getSimple();

  if (!isValid || student == null) {
    setResponse(ctx, BAD_REQUEST);
    return;
  }

  await crossCheckService.saveSolution(student.id, url);
  setResponse(ctx, OK);
};

const getSolution = (_: ILogger) => async (ctx: Router.RouterContext) => {
  const { githubId, courseId, courseTaskId } = ctx.params;
  const crossCheckService = new CrossCheckService(courseTaskId);
  const isValid = await crossCheckService.isValidTask();
  const student = await new StudentService(courseId, githubId).getSimple();
  if (!isValid || student == null) {
    setResponse(ctx, BAD_REQUEST);
    return;
  }

  const result = await crossCheckService.findSolution(student.id);
  setResponse(ctx, result != null ? OK : BAD_REQUEST, result);
};

const createResult = (_: ILogger) => async (ctx: Router.RouterContext) => {
  const { githubId, courseId, courseTaskId } = ctx.params;
  const { user } = ctx.state as { user: IUserSession };
  const crossCheckService = new CrossCheckService(courseTaskId);
  const [student, checker, isValid] = await Promise.all([
    new StudentService(courseId, githubId).getSimple(),
    new StudentService(courseId, user.githubId).getSimple(),
    crossCheckService.isValidTask(),
  ]);

  if (student == null || checker == null || !isValid) {
    setErrorResponse(ctx, BAD_REQUEST, 'not valid student or course task');
    return;
  }
  const { score, comment }: { score: number; comment: string } = ctx.request.body;
  await crossCheckService.saveResult(student.id, checker.id, { score, comment }, user.id);
  setResponse(ctx, OK);
};

const getResult = (_: ILogger) => async (ctx: Router.RouterContext) => {
  const { githubId, courseId, courseTaskId } = ctx.params;
  const { user } = ctx.state as { user: IUserSession };
  const crossCheckService = new CrossCheckService(courseTaskId);
  const [student, checker, isValid] = await Promise.all([
    new StudentService(courseId, githubId).getSimple(),
    new StudentService(courseId, user.githubId).getSimple(),
    crossCheckService.isValidTask(),
  ]);
  if (student == null || checker == null || !isValid) {
    setErrorResponse(ctx, BAD_REQUEST, 'not valid student or course task');
    return;
  }

  const result = await crossCheckService.getResult(student.id, checker.id);
  if (result == null) {
    setErrorResponse(ctx, BAD_REQUEST, 'no assigned cross-check');
    return;
  }
  setResponse(ctx, OK, result);
};

const getAssignments = (_: ILogger) => async (ctx: Router.RouterContext) => {
  const { githubId, courseId, courseTaskId } = ctx.params;
  const crossCheckService = new CrossCheckService(courseTaskId);
  const [checker, isValid] = await Promise.all([
    new StudentService(courseId, githubId).getSimple(),
    crossCheckService.isValidTask(),
  ]);

  if (checker == null || !isValid) {
    setErrorResponse(ctx, BAD_REQUEST, 'not valid student or course task');
    return;
  }
  const result = await crossCheckService.getStudents(checker.id);
  setResponse(ctx, OK, result);
};

const getFeedback = (_: ILogger) => async (ctx: Router.RouterContext) => {
  const { githubId, courseId, courseTaskId } = ctx.params;
  const crossCheckService = new CrossCheckService(courseTaskId);
  const [student, isValid] = await Promise.all([
    new StudentService(courseId, githubId).getSimple(),
    crossCheckService.isValidTask(),
  ]);

  if (student == null || !isValid) {
    setErrorResponse(ctx, BAD_REQUEST, 'not valid student or course task');
    return;
  }
  const result = await crossCheckService.getFeedback(student.id);
  setResponse(ctx, OK, result);
};

export const createDistribution = (_: ILogger) => async (ctx: Router.RouterContext) => {
  const { courseTaskId } = ctx.params;
  const crossCheckService = new CrossCheckService(courseTaskId);
  const isValid = await crossCheckService.isValidTask();
  if (!isValid) {
    setResponse(ctx, BAD_REQUEST);
    return;
  }
  const result = await crossCheckService.distribute();
  setResponse(ctx, OK, result);
};

export const createCompletion = (__: ILogger) => async (ctx: Router.RouterContext) => {
  const { courseTaskId } = ctx.params;
  const crossCheckService = new CrossCheckService(courseTaskId);
  const isValid = await crossCheckService.isValidTask();
  if (!isValid) {
    setResponse(ctx, BAD_REQUEST);
    return;
  }
  await crossCheckService.complete();
  setResponse(ctx, OK);
};
