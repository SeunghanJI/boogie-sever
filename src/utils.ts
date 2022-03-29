import { realpathSync } from 'fs';

/*
    해당 Object에 필수로 하는 key값이 존재하는지 검사
    @param {Array} key => array형태로 검사하고 싶은 key 값
    @param {Object} data => key 값 존재 여부를 검사 할 오브젝트
    @returns boolean => 조건 만족 시 true 아니면 fasle
*/
export const checkRequiredProperties = (
  keys: string[],
  data: {} = {}
): boolean => {
  if (!Array.isArray(keys) || !keys.length || !Object.keys(data).length) {
    return false;
  }

  const isSatisfied: boolean = keys.every((key) => data.hasOwnProperty(key));
  return isSatisfied;
};

/*
    해당 data의 value중 비어있는 값이 존재하는지 검사
    @param {Object} data => 버어있는 vlaue가 존재하는지 검사 할 오브젝트
    @returns boolean => 비어있는 값이 없으면 true 아니면 fasle
*/
export const checkObjectValueEmpty = (data: {} = {}): boolean => {
  if (!Object.keys(data).length) {
    return false;
  }

  let isSatisfied = Object.values(data).every(
    (value) => value === undefined || value === null || value === ''
  );
  return !isSatisfied;
};
