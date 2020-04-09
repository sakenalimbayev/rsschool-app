import { AbstractRepository, EntityRepository, getRepository, getManager } from 'typeorm';
import { TaskSolution, TaskSolutionChecker, TaskSolutionResult } from '../models';

@EntityRepository(TaskSolution)
export class CrossCheckRepository extends AbstractRepository<TaskSolution> {
  public async saveSolution(courseTaskId: number, studentId: number, data: { url: string }) {
    const solution = await getRepository(TaskSolution).findOne({ courseTaskId, studentId });
    if (solution == null) {
      await getRepository(TaskSolution).insert({ studentId, courseTaskId, url: data.url });
      return;
    }
    await getRepository(TaskSolution).update(solution.id, { url: data.url });
  }

  public async findSolution(courseTaskId: number, studentId: number) {
    const result = await getRepository(TaskSolution).findOne({ courseTaskId, studentId });
    if (result == null) {
      return null;
    }
    return { id: result.id, url: result.url, updatedDate: result.updatedDate };
  }

  public async findSolutionsWithoutReviewer(courseTaskId: number) {
    const records = await getRepository(TaskSolution)
      .createQueryBuilder('ts')
      .leftJoin('task_solution_checker', 'tsc', 'tsc."taskSolutionId" = ts.id')
      .where('ts."courseTaskId" = :courseTaskId', { courseTaskId })
      .andWhere('tsc.id IS NULL')
      .getMany();
    return records.map(r => ({ id: r.id, studentId: r.studentId }));
  }

  public async findReviewer(courseTaskId: number, reviewerId: number, studentId: number) {
    return getRepository(TaskSolutionChecker).findOne({
      where: {
        studentId,
        checkerId: reviewerId,
        courseTaskId,
      },
    });
  }

  public async findStudentsByReviewer(courseTaskId: number, reviewerId: number) {
    return getRepository(TaskSolutionChecker)
      .createQueryBuilder('c')
      .innerJoin('c.taskSolution', 'taskSolution')
      .innerJoin('c.student', 'student')
      .innerJoin('student.user', 'user')
      .addSelect(['student.id', 'student.userId', 'taskSolution.url', ...this.getPrimaryUserFields()])
      .where('c.checkerId = :reviewerId', { reviewerId })
      .andWhere('c.courseTaskId = :courseTaskId', { courseTaskId })
      .getMany();
  }

  public async findResult(courseTaskId: number, reviewerId: number, studentId: number) {
    return getRepository(TaskSolutionResult).findOne({
      where: {
        studentId,
        checkerId: reviewerId,
        courseTaskId,
      },
    });
  }

  public async findReviewResults(courseTaskId: number, minReviewedCount: number) {
    const query = getManager()
      .createQueryBuilder()
      .select(['ROUND(AVG("score")) as "score"', '"studentId" '])
      .from(qb => {
        // do sub query to select only top X scores
        const query = qb
          .from(TaskSolutionResult, 'tsr')
          .select([
            'tsr.studentId as "studentId"',
            'tsr.score as "score"',
            'row_number() OVER (PARTITION by tsr.studentId ORDER BY tsr.score desc) as "rownum"',
          ])
          .where(qb => {
            // query students who checked enough tasks
            const query = qb
              .subQuery()
              .select('r."checkerId"')
              .from(TaskSolutionChecker, 'c')
              .leftJoin(
                'task_solution_result',
                'r',
                ['r."checkerId" = c."checkerId"', 'r."studentId" = c."studentId"'].join(' AND '),
              )
              .where(`c."courseTaskId" = :courseTaskId`, { courseTaskId })
              .andWhere('r.id IS NOT NULL')
              .groupBy('r."checkerId"')
              .having(`COUNT(c.id) >= :count`, { count: minReviewedCount })
              .getQuery();
            return `"studentId" IN ${query}`;
          })
          .andWhere('tsr."courseTaskId" = :courseTaskId', { courseTaskId })
          .orderBy('tsr.studentId')
          .orderBy('tsr.score', 'DESC');
        return query;
      }, 's')
      .where('rownum <= :count', { count: minReviewedCount })
      .groupBy('"studentId"');

    const records = await query.getRawMany();

    return records.map(record => ({ studentId: record.studentId, score: Number(record.score) }));
  }

  public async saveResult(
    courseTaskId: number,
    studentId: number,
    reviewerId: number,
    data: Pick<TaskSolutionResult, 'score' | 'comment'> & { authorId: number },
  ) {
    const historicalResult = {
      score: data.score,
      comment: data.comment ?? '',
      authorId: data.authorId,
      dateTime: Date.now(),
    };
    const existing = await this.findResult(courseTaskId, reviewerId, studentId);

    if (existing != null) {
      const { historicalScores } = existing;
      historicalScores.push(historicalResult);
      await getRepository(TaskSolutionResult).update(existing.id, { ...data, historicalScores });
      return;
    }

    await getRepository(TaskSolutionResult).insert({
      studentId,
      courseTaskId,
      checkerId: reviewerId,
      historicalScores: [historicalResult],
      ...data,
    });
  }

  public async saveReviewers(
    reviewers: Pick<TaskSolutionChecker, 'studentId' | 'checkerId' | 'courseTaskId' | 'taskSolutionId'>[],
  ) {
    await getRepository(TaskSolutionChecker).save(reviewers);
  }

  public async findReviewersFeedback(courseTaskId: number, studentId: number) {
    const comments = (await getRepository(TaskSolutionResult)
      .createQueryBuilder('tsr')
      .select(['tsr.comment'])
      .where('tsr.studentId = :studentId', { studentId })
      .andWhere('tsr.courseTaskId = :courseTaskId', { courseTaskId })
      .getMany()) as { comment: string }[];

    const taskSolution = await getRepository(TaskSolution)
      .createQueryBuilder('ts')
      .where('ts.studentId = :studentId', { studentId })
      .andWhere('ts.courseTaskId = :courseTaskId', { courseTaskId })
      .getOne();
    return { url: taskSolution?.url, comments };
  }

  private getPrimaryUserFields(modelName = 'user') {
    return [
      `${modelName}.id`,
      `${modelName}.firstName`,
      `${modelName}.lastName`,
      `${modelName}.githubId`,
      `${modelName}.cityName`,
      `${modelName}.countryName`,
    ];
  }
}
