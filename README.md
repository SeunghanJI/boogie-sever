## 실제 서비스 중인 페이지

[서일대 졸업작품전](http://seoilsw.kr/)

## 📃 프로젝트 목적

- 졸업작품
- 학교의 기존 졸업작품전 페이지가 기능 및 유지 보수 성이 낮은 편이었기에 우리가 새롭게 리뉴얼해서 만들어 보자로 시작하여
  **졸업작품 전시와 취업 연계를 한 번에 할 수 있도록 개선하여 제작**

## 🔈 프로젝트를 시작하는 방법

1. npm install을 이용하여 모듈 설치
2. npm run start를 사용하여 Server 실행

## 💻 사용한 기술, 모듈, 외부 리소스

#### 주 기술

<img src="https://img.shields.io/badge/javascript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black">
<img src="https://img.shields.io/badge/react-61DAFB?style=for-the-badge&logo=react&logoColor=black">

#### 모듈, 외부 리소스

- typescript
- axios
- aws-sdk
- cookie-parser
- dayjs
- dotenv
- express
- jsonwebtoken
- multer, multer-s3
- mysql
- nodemailer
- sharp
- uuid

## 📂 프로젝트 폴더 구조

```
📦src
 ┣ 📂api
 ┃ ┣ 📂auth
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂banner
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂category
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂community
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂employment
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂help
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂management
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂map
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂profile
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂senier-project
 ┃ ┃ ┗ 📜index.ts
 ┃ ┣ 📂token
 ┃ ┃ ┗ 📜index.ts
 ┃ ┗ 📜api.ts
 ┣ 📂mail
 ┃ ┗ 📜index.ts
 ┣ 📂s3
 ┃ ┗ 📜index.ts
 ┣ 📂token
 ┃ ┗ 📜index.ts
 ┣ 📂view
 ┃ ┗ 📜index.ts
 ┣ 📜app.ts
 ┣ 📜common.ts
 ┣ 📜error.ts
 ┗ 📜utils.ts
```

## 📸 프로젝트 사진

![image](https://user-images.githubusercontent.com/94745651/201587567-0f4c6d1b-5727-469a-8c0b-71dae4f91b2b.png)

---

![image (1)](https://user-images.githubusercontent.com/94745651/201587634-aecd2afe-f72d-4744-8061-135b9668af74.png)

## 📜 기능

- 졸업작품전
  - 졸업작품전 글 게시, 수정, 삭제
  - 작성된 졸업작품을 한 눈에 보기 쉽게 제공
- 채용공고
  - 채용공고 글 작성, 수정, 삭제
  - 작성된 채용공고를 한 눈에 보기 쉽게 제공
  - 작성된 채용공고를 보고 지원 가능
- 커뮤니티
  - 사용자가 여러가지 고민 등을 올릴 수 있는 커뮤니티 제공
- 관리자 페이지
  - 학생 가입자의 학번, 이름 수정
  - 관리자 추가 및 삭제
  - 배너 사진 추가 및 삭제
  - 졸업작품전 개시 연도 추가 및 삭제
