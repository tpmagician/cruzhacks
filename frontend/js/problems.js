// Problem bank for LeetCode-style technical questions. Each interview draws from it
// at random, matched to the candidate's level, with no repeated pattern in one
// interview and recently seen problems skipped. The interviewer writes the full
// statement and examples in its own words from the title and brief.

const CODING = [
  // Easy
  ['Two Sum', 'Easy', 'hash map', 'Return the indices of the two numbers in an array that add up to a target.'],
  ['Valid Parentheses', 'Easy', 'stack', 'Decide whether a string of brackets ()[]{} is properly opened and closed.'],
  ['Merge Two Sorted Lists', 'Easy', 'linked list', 'Merge two sorted linked lists into one sorted list.'],
  ['Best Time to Buy and Sell Stock', 'Easy', 'single pass', 'Given daily prices, find the maximum profit from one buy followed by one sell.'],
  ['Valid Anagram', 'Easy', 'counting', 'Decide whether two strings are anagrams of each other.'],
  ['Binary Search', 'Easy', 'binary search', 'Find the index of a target in a sorted array, or -1, in O(log n).'],
  ['Maximum Depth of Binary Tree', 'Easy', 'tree DFS', 'Return the number of nodes on the longest root-to-leaf path.'],
  ['Invert Binary Tree', 'Easy', 'tree recursion', 'Mirror a binary tree so every left and right child are swapped.'],
  ['Contains Duplicate', 'Easy', 'hash set', 'Decide whether any value appears at least twice in an array.'],
  ['Climbing Stairs', 'Easy', '1D dynamic programming', 'Count the distinct ways to climb n stairs taking 1 or 2 steps at a time.'],
  ['Reverse Linked List', 'Easy', 'linked list', 'Reverse a singly linked list and return the new head.'],
  ['Majority Element', 'Easy', 'voting / counting', 'Find the element that appears more than n/2 times.'],
  ['Move Zeroes', 'Easy', 'two pointers', 'Move all zeros to the end of an array in place, keeping the order of other elements.'],
  ['Valid Palindrome', 'Easy', 'two pointers', 'Decide whether a string is a palindrome considering only letters and digits, ignoring case.'],
  ['Linked List Cycle', 'Easy', 'fast and slow pointers', 'Decide whether a linked list contains a cycle using O(1) extra space.'],
  ['First Unique Character in a String', 'Easy', 'counting', 'Return the index of the first character that appears exactly once.'],
  ['Missing Number', 'Easy', 'math / bit manipulation', 'Given n distinct numbers from 0..n, find the one that is missing.'],
  ['Flood Fill', 'Easy', 'grid DFS', 'Recolor the connected region of same-colored pixels starting from a cell.'],
  ['Diameter of Binary Tree', 'Easy', 'tree DFS', 'Return the length of the longest path between any two nodes in a binary tree.'],
  ['Squares of a Sorted Array', 'Easy', 'two pointers', 'Return the squares of a sorted array (which may contain negatives) in sorted order.'],

  // Medium
  ['Group Anagrams', 'Medium', 'hashing', 'Group a list of strings so that anagrams are together.'],
  ['Top K Frequent Elements', 'Medium', 'heap / bucket sort', 'Return the k most frequent values in an array, faster than O(n log n).'],
  ['Product of Array Except Self', 'Medium', 'prefix and suffix products', 'For each index, return the product of every other element without using division.'],
  ['Longest Substring Without Repeating Characters', 'Medium', 'sliding window', 'Find the length of the longest substring with all distinct characters.'],
  ['Longest Repeating Character Replacement', 'Medium', 'sliding window', 'With at most k character replacements, find the longest substring of one repeated letter.'],
  ['Find All Anagrams in a String', 'Medium', 'sliding window', 'Return every start index in s where a permutation of p begins.'],
  ['Container With Most Water', 'Medium', 'two pointers', 'Choose two vertical lines that hold the most water between them.'],
  ['3Sum', 'Medium', 'sorting + two pointers', 'Return all unique triplets in an array that sum to zero.'],
  ['Merge Intervals', 'Medium', 'intervals', 'Merge all overlapping intervals in a list.'],
  ['Insert Interval', 'Medium', 'intervals', 'Insert a new interval into a sorted, non-overlapping list and merge as needed.'],
  ['Non-overlapping Intervals', 'Medium', 'greedy', 'Return the minimum number of intervals to remove so the rest do not overlap.'],
  ['Meeting Rooms II', 'Medium', 'heap / sweep line', 'Given meeting time intervals, find the minimum number of rooms required.'],
  ['Number of Islands', 'Medium', 'grid BFS/DFS', 'Count the islands of 1s connected horizontally or vertically in a grid.'],
  ['Rotting Oranges', 'Medium', 'multi-source BFS', 'Return the minutes until no fresh orange remains, or -1 if impossible.'],
  ['Course Schedule', 'Medium', 'topological sort', 'Given course prerequisites, decide whether all courses can be finished.'],
  ['Clone Graph', 'Medium', 'graph traversal', 'Return a deep copy of a connected undirected graph.'],
  ['Number of Connected Components', 'Medium', 'union-find', 'Given n nodes and undirected edges, count the connected components.'],
  ['Binary Tree Level Order Traversal', 'Medium', 'tree BFS', 'Return the values of a binary tree level by level.'],
  ['Validate Binary Search Tree', 'Medium', 'tree DFS with bounds', 'Decide whether a binary tree is a valid binary search tree.'],
  ['Lowest Common Ancestor of a BST', 'Medium', 'BST properties', 'Find the lowest common ancestor of two nodes in a binary search tree.'],
  ['Kth Smallest Element in a BST', 'Medium', 'in-order traversal', 'Return the kth smallest value in a binary search tree.'],
  ['Binary Tree Right Side View', 'Medium', 'tree BFS', 'Return the values visible when looking at a binary tree from the right.'],
  ['Search in Rotated Sorted Array', 'Medium', 'binary search', 'Find a target in a sorted array that was rotated at an unknown pivot, in O(log n).'],
  ['Find Minimum in Rotated Sorted Array', 'Medium', 'binary search', 'Find the minimum of a rotated sorted array in O(log n).'],
  ['Koko Eating Bananas', 'Medium', 'binary search on the answer', 'Find the minimum eating speed to finish all banana piles within h hours.'],
  ['Daily Temperatures', 'Medium', 'monotonic stack', 'For each day, return how many days until a warmer temperature.'],
  ['Evaluate Reverse Polish Notation', 'Medium', 'stack', 'Evaluate an arithmetic expression given in reverse Polish notation.'],
  ['Decode String', 'Medium', 'stack', 'Decode strings like "3[a2[c]]" into "accaccacc".'],
  ['Min Stack', 'Medium', 'design', 'Design a stack that also returns its minimum element in O(1).'],
  ['LRU Cache', 'Medium', 'design: hash map + linked list', 'Design a least-recently-used cache with O(1) get and put.'],
  ['Time Based Key-Value Store', 'Medium', 'design + binary search', 'Design a store that returns the value for a key as of a given timestamp.'],
  ['Implement Trie', 'Medium', 'trie', 'Implement a prefix tree with insert, search, and startsWith.'],
  ['Subsets', 'Medium', 'backtracking', 'Return all possible subsets of a set of distinct integers.'],
  ['Combination Sum', 'Medium', 'backtracking', 'Return all combinations of candidates (reusable) that sum to a target.'],
  ['Permutations', 'Medium', 'backtracking', 'Return all permutations of an array of distinct integers.'],
  ['Word Search', 'Medium', 'grid backtracking', 'Decide whether a word can be traced through adjacent cells of a letter grid.'],
  ['House Robber', 'Medium', '1D dynamic programming', 'Maximize the sum of non-adjacent values in an array.'],
  ['Coin Change', 'Medium', 'dynamic programming', 'Return the fewest coins needed to make an amount, or -1 if impossible.'],
  ['Longest Increasing Subsequence', 'Medium', 'dynamic programming', 'Return the length of the longest strictly increasing subsequence.'],
  ['Unique Paths', 'Medium', '2D dynamic programming', 'Count the paths from the top-left to bottom-right of a grid moving only right or down.'],
  ['Longest Common Subsequence', 'Medium', '2D dynamic programming', 'Return the length of the longest common subsequence of two strings.'],
  ['Word Break', 'Medium', 'dynamic programming', 'Decide whether a string can be split into words from a dictionary.'],
  ['Jump Game', 'Medium', 'greedy', 'Decide whether you can reach the last index given maximum jump lengths.'],
  ['Gas Station', 'Medium', 'greedy', 'Find the starting station that lets you complete a circular route, or -1.'],
  ['Task Scheduler', 'Medium', 'greedy / counting', 'Return the minimum time to run tasks when identical tasks need a cooldown of n.'],
  ['Subarray Sum Equals K', 'Medium', 'prefix sums + hash map', 'Count the contiguous subarrays whose sum equals k.'],
  ['Kth Largest Element in an Array', 'Medium', 'heap / quickselect', 'Return the kth largest element without fully sorting.'],
  ['Rotate Image', 'Medium', 'matrix', 'Rotate an n x n matrix 90 degrees clockwise in place.'],
  ['Spiral Matrix', 'Medium', 'matrix', 'Return all elements of a matrix in spiral order.'],
  ['Set Matrix Zeroes', 'Medium', 'matrix', 'If a cell is 0, set its whole row and column to 0, in place.'],
  ['Remove Nth Node From End of List', 'Medium', 'two pointers', 'Remove the nth node from the end of a linked list in one pass.'],
  ['Add Two Numbers', 'Medium', 'linked list', 'Add two numbers stored as reversed digit linked lists.'],
  ['Pacific Atlantic Water Flow', 'Medium', 'grid DFS from borders', 'Find cells from which water can flow to both the Pacific and Atlantic edges.'],
  ['Network Delay Time', 'Medium', "Dijkstra's algorithm", 'Return how long a signal takes to reach all nodes in a weighted directed graph.'],
  ['Encode and Decode Strings', 'Medium', 'string design', 'Design encode/decode functions that turn a list of strings into one string and back.'],
  ['Longest Consecutive Sequence', 'Medium', 'hash set', 'Return the length of the longest run of consecutive integers, in O(n).'],

  // Hard
  ['Trapping Rain Water', 'Hard', 'two pointers', 'Compute how much rain water is trapped between bars of given heights.'],
  ['Minimum Window Substring', 'Hard', 'sliding window', 'Find the smallest substring of s containing every character of t.'],
  ['Merge k Sorted Lists', 'Hard', 'heap', 'Merge k sorted linked lists into one sorted list.'],
  ['Find Median from Data Stream', 'Hard', 'two heaps', 'Design a structure that adds numbers and returns the running median.'],
  ['Sliding Window Maximum', 'Hard', 'monotonic deque', 'Return the maximum of every window of size k in an array.'],
  ['Largest Rectangle in Histogram', 'Hard', 'monotonic stack', 'Find the area of the largest rectangle in a histogram.'],
  ['Word Ladder', 'Hard', 'BFS', 'Return the length of the shortest one-letter-at-a-time transformation between two words.'],
  ['Serialize and Deserialize Binary Tree', 'Hard', 'tree design', 'Design functions to turn a binary tree into a string and back.'],
  ['Edit Distance', 'Hard', '2D dynamic programming', 'Return the minimum insertions, deletions, and replacements to turn one word into another.'],
  ['Alien Dictionary', 'Hard', 'topological sort', 'Derive a letter order from a list of words sorted in an alien language.'],
];

const SQL = [
  // Easy
  ['Combine Two Tables', 'Easy', 'LEFT JOIN', "List every person's name with their city and state, even if they have no address."],
  ['Duplicate Emails', 'Easy', 'GROUP BY + HAVING', 'Report all email addresses that appear more than once.'],
  ['Customers Who Never Order', 'Easy', 'anti-join', 'List customers who have never placed an order.'],
  ['Employees Earning More Than Their Managers', 'Easy', 'self join', 'Find employees who earn more than their own manager.'],
  ['Find Customer Referee', 'Easy', 'NULL handling', 'List customers not referred by a specific customer id, including those with no referrer.'],
  ['Not Boring Movies', 'Easy', 'filtering + ordering', 'Return odd-id movies whose description is not "boring", by rating descending.'],
  ['Classes With at Least 5 Students', 'Easy', 'GROUP BY + HAVING', 'Report classes that have at least five students.'],

  // Medium
  ['Second Highest Salary', 'Medium', 'subquery / OFFSET', 'Return the second highest distinct salary, or NULL if there is none.'],
  ['Rank Scores', 'Medium', 'DENSE_RANK', 'Rank scores from highest to lowest with no gaps after ties.'],
  ['Department Highest Salary', 'Medium', 'join + window or subquery', 'Find the employees with the highest salary in each department.'],
  ['Consecutive Numbers', 'Medium', 'LAG / LEAD', 'Find numbers that appear at least three times in a row.'],
  ['Monthly Transactions', 'Medium', 'conditional aggregation', 'Per month and country, report transaction counts and totals, overall and approved only.'],
  ['Game Play Analysis: Day-One Retention', 'Medium', 'first-event + self join', "Report the fraction of players who logged in again the day after their first login."],
  ['Confirmation Rate', 'Medium', 'LEFT JOIN + AVG', "Compute each user's confirmation rate, treating users with no requests as 0."],
  ['Restaurant Growth', 'Medium', 'window frames', 'Report the 7-day rolling total and average of customer spend.'],
  ['Last Person to Fit in the Bus', 'Medium', 'running SUM', 'Find the last person who can board in order before a weight limit is exceeded.'],
  ['Managers with at Least 5 Direct Reports', 'Medium', 'GROUP BY + join', 'List managers who have five or more direct reports.'],
  ['Immediate Food Delivery', 'Medium', 'first order per customer', "Report the share of customers whose first order was delivered the same day it was placed."],
  ['Exchange Seats', 'Medium', 'CASE', 'Swap the seats of every two consecutive students.'],
  ['Product Price at a Given Date', 'Medium', 'latest row per group', 'Find every product price as of a date, defaulting to 10 if no change happened before it.'],
  ['Count Salary Categories', 'Medium', 'UNION / conditional counts', 'Count accounts in low, average, and high salary bands, including empty bands.'],

  // Hard
  ['Department Top Three Salaries', 'Hard', 'DENSE_RANK partitioned', 'Find employees earning one of the top three unique salaries in their department.'],
  ['Trips and Users', 'Hard', 'multi-join + conditional rate', 'Compute the daily cancellation rate for trips between unbanned users.'],
  ['Human Traffic of Stadium', 'Hard', 'consecutive-row islands', 'Find runs of three or more consecutive days with at least 100 visitors.'],
  ['Median Employee Salary', 'Hard', 'ROW_NUMBER + COUNT window', 'Find the median salary row(s) for each company.'],
];

const toEntry = ([title, difficulty, pattern, brief]) => ({ title, difficulty, pattern, brief });
const BANK = { coding: CODING.map(toEntry), sql: SQL.map(toEntry) };

// Chance of each difficulty for a problem, by experience level.
const MIX = {
  Entry: { Easy: 0.6, Medium: 0.4, Hard: 0 },
  Mid: { Easy: 0.2, Medium: 0.75, Hard: 0.05 },
  Senior: { Easy: 0, Medium: 0.6, Hard: 0.4 },
};

const RECENT_KEY = 'ips-recent-problems';
const RECENT_MAX = 40;

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveRecent(titles) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([...titles, ...loadRecent()].slice(0, RECENT_MAX)));
  } catch {
    // storage unavailable; repeats are just more likely
  }
}

function pickDifficulty(level) {
  const mix = MIX[level] ?? MIX.Mid;
  let r = Math.random();
  for (const [d, p] of Object.entries(mix)) {
    if ((r -= p) < 0) return d;
  }
  return 'Medium';
}

/**
 * Picks `count` problems of a type ('coding' | 'sql') for one interview.
 * Avoids reusing a pattern within the interview and prefers problems not seen recently.
 */
export function pickProblems(type, count, level) {
  const bank = BANK[type] ?? [];
  const recent = new Set(loadRecent());
  const picked = [];
  for (let i = 0; i < count; i++) {
    const want = pickDifficulty(level);
    const usable = (p) => !picked.includes(p) && !picked.some((q) => q.pattern === p.pattern);
    // Most specific pool first; relax the filters if a pool runs dry.
    const pools = [
      bank.filter((p) => usable(p) && p.difficulty === want && !recent.has(p.title)),
      bank.filter((p) => usable(p) && p.difficulty === want),
      bank.filter((p) => usable(p) && !recent.has(p.title)),
      bank.filter(usable),
    ];
    const pool = pools.find((p) => p.length);
    if (!pool) break;
    picked.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  saveRecent(picked.map((p) => p.title));
  return picked;
}

export const PROBLEM_COUNTS = { coding: CODING.length, sql: SQL.length };
