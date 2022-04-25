import { v4 as uuidv4 } from 'uuid';

/*
    해당 Object에 필수로 하는 key값이 존재하는지 검사
    @param {Array} key => array형태로 검사하고 싶은 key 값
    @param {Object} data => key 값 존재 여부를 검사 할 오브젝트
    @returns boolean => 조건 만족 시 true 아니면 false
*/
export const checkRequiredProperties = (
  keys: string[],
  data: any = {}
): boolean => {
  console.log();
  if (!Array.isArray(keys) || !keys.length || !Object.keys(data).length) {
    return false;
  }

  const isSatisfied: boolean = keys.every((key) => data.hasOwnProperty(key));
  return isSatisfied;
};

/*
    해당 data의 value중 비어있는 값이 존재하는지 검사
    @param {Object} data => 버어있는 value가 존재하는지 검사 할 오브젝트
    @returns boolean => 비어있는 값이 없으면 true 아니면 false
*/
export const checkObjectValueEmpty = (data: any = {}): boolean => {
  if (!Object.keys(data).length) {
    return false;
  }

  let isSatisfied = Object.values(data).every(
    (value) => value === undefined || value === null || value === ''
  );
  return !isSatisfied;
};

/*
    uuid의 v4기반의 id값을 16자리로 자른후 리턴
    @returns string => 16자리의 랜덤 문자열을 리턴
*/
export const getUniqueID = (): string => {
  return uuidv4().split('-').join('').substring(0, 16);
};

/*
    해당 string이 email정규식에 부합하는지 체크
    @params {string} email => 정규식에 테스트할 문자열
    @returns boolean => 정규식에 부합하면 true 아니면 false
*/
export const verifyEmail = (email: string = ''): boolean => {
  const regularEmail: RegExp =
    /^([0-9a-zA-Z_.-]+)@([0-9a-zA-Z_-]+)(\.[0-9a-zA-Z_-]+){1,3}$/;

  return regularEmail.test(email);
};
