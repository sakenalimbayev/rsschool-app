import { getCustomRepository } from 'typeorm';
import { CrossCheckRepository } from '../repositories/crossCheck';
import { createCrossCheckPairs } from '../rules/distribution';
import * as courseService from './course.service';
import { saveScore } from './taskResults.service';
import * as taskService from './tasks.service';

export class CrossCheckService {
  private defaultPairsCount = 4;

  constructor(private courseTaskId: number) {}

  public async isValidTask() {
    const courseTask = await taskService.getCourseTask(this.courseTaskId);
    return courseTask?.checker === 'crossCheck';
  }

  public async saveSolution(studentId: number, url: string) {
    const repo = getCustomRepository(CrossCheckRepository);
    await repo.saveSolution(this.courseTaskId, studentId, { url });
  }

  public async findSolution(studentId: number) {
    const repo = getCustomRepository(CrossCheckRepository);
    return repo.findSolution(this.courseTaskId, studentId);
  }

  public async saveResult(
    studentId: number,
    reviewerId: number,
    inputData: { score: number; comment: string },
    userId: number,
  ) {
    const data = { score: Math.round(Number(inputData.score)), comment: inputData.comment || '' };
    const repo = getCustomRepository(CrossCheckRepository);
    const reviewer = await repo.findReviewer(this.courseTaskId, reviewerId, studentId);
    if (reviewer == null) {
      return;
    }
    await repo.saveResult(this.courseTaskId, reviewerId, studentId, {
      score: data.score,
      comment: data.comment,
      authorId: userId,
    });
  }

  public async getResult(studentId: number, reviewerId: number) {
    const repo = getCustomRepository(CrossCheckRepository);
    const reviewer = await repo.findReviewer(this.courseTaskId, reviewerId, studentId);
    if (reviewer == null) {
      return null;
    }

    return repo.findResult(this.courseTaskId, reviewerId, studentId);
  }

  public async distribute() {
    const repo = getCustomRepository(CrossCheckRepository);
    const [solutions, courseTask] = await Promise.all([
      repo.findSolutionsWithoutReviewer(this.courseTaskId),
      taskService.getCourseTask(this.courseTaskId),
    ] as const);
    const solutionsMap = new Map<number, number>();
    for (const solution of solutions) {
      solutionsMap.set(solution.studentId, solution.id);
    }

    const students = Array.from(solutionsMap.keys());
    const pairs = createCrossCheckPairs(students, courseTask?.pairsCount ?? this.defaultPairsCount);

    const crossCheckPairs = pairs
      .filter(pair => solutionsMap.has(pair.studentId))
      .map(pair => ({
        ...pair,
        courseTaskId: this.courseTaskId,
        taskSolutionId: solutionsMap.get(pair.studentId)!,
      }));

    await repo.saveReviewers(crossCheckPairs);
    return crossCheckPairs;
  }

  public async complete() {
    const repo = getCustomRepository(CrossCheckRepository);
    const courseTask = await taskService.getCourseTask(this.courseTaskId);
    const pairsCount = (courseTask?.pairsCount ?? this.defaultPairsCount) - 1;
    const studentScores = await repo.findReviewResults(this.courseTaskId, pairsCount);

    for (const studentScore of studentScores) {
      const data = { authorId: -1, comment: 'Cross-Check score', score: studentScore.score };
      await saveScore(studentScore.studentId, this.courseTaskId, data);
    }
  }

  public async getStudents(reviewerId: number) {
    const repo = getCustomRepository(CrossCheckRepository);
    return (await repo.findStudentsByReviewer(this.courseTaskId, reviewerId)).map(r => ({
      student: courseService.convertToStudentBasic(r.student),
      url: r.taskSolution.url,
    }));
  }

  public async getFeedback(studentId: number) {
    const repo = getCustomRepository(CrossCheckRepository);
    const feedback = await repo.findReviewersFeedback(this.courseTaskId, studentId);
    return { url: feedback.url, comments: feedback.comments.map(({ comment }) => ({ comment })) };
  }
}
