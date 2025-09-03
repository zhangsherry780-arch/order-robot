-- 订餐系统数据库架构
CREATE DATABASE IF NOT EXISTS order_robot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE order_robot;

-- 员工表
CREATE TABLE employees (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL COMMENT '员工姓名',
    department VARCHAR(100) DEFAULT NULL COMMENT '部门',
    feishu_user_id VARCHAR(100) UNIQUE DEFAULT NULL COMMENT '飞书用户ID',
    email VARCHAR(200) DEFAULT NULL COMMENT '邮箱',
    avatar VARCHAR(500) DEFAULT NULL COMMENT '头像URL',
    active BOOLEAN DEFAULT TRUE COMMENT '是否活跃',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_feishu_user_id (feishu_user_id),
    INDEX idx_department (department)
) COMMENT = '员工信息表';

-- 餐厅表
CREATE TABLE restaurants (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(200) NOT NULL COMMENT '餐厅名称',
    description TEXT COMMENT '餐厅描述',
    phone VARCHAR(50) DEFAULT NULL COMMENT '联系电话',
    address VARCHAR(500) DEFAULT NULL COMMENT '餐厅地址',
    available_days JSON COMMENT '可用星期几 [1,2,3,4,5]',
    active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_active (active)
) COMMENT = '餐厅信息表';

-- 菜品表
CREATE TABLE dishes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(200) NOT NULL COMMENT '菜品名称',
    description TEXT COMMENT '菜品描述',
    category VARCHAR(100) DEFAULT NULL COMMENT '菜品分类',
    price DECIMAL(10,2) DEFAULT 0.00 COMMENT '价格',
    restaurant_id INT NOT NULL COMMENT '餐厅ID',
    image_url VARCHAR(500) DEFAULT NULL COMMENT '图片URL',
    rating DECIMAL(3,2) DEFAULT 0.00 COMMENT '平均评分',
    meal_type ENUM('lunch', 'dinner') NOT NULL COMMENT '餐次类型',
    active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    INDEX idx_restaurant_meal (restaurant_id, meal_type),
    INDEX idx_name (name),
    INDEX idx_active (active)
) COMMENT = '菜品信息表';

-- 周菜单表
CREATE TABLE weekly_menus (
    id INT PRIMARY KEY AUTO_INCREMENT,
    week_start DATE NOT NULL COMMENT '周开始日期',
    day_of_week TINYINT NOT NULL COMMENT '星期几(1-7)',
    meal_type ENUM('lunch', 'dinner') NOT NULL COMMENT '餐次',
    dish_name VARCHAR(200) NOT NULL COMMENT '菜品名称',
    restaurant_name VARCHAR(200) NOT NULL COMMENT '餐厅名称',
    description TEXT COMMENT '描述',
    category VARCHAR(100) DEFAULT NULL COMMENT '分类',
    price DECIMAL(10,2) DEFAULT 0.00 COMMENT '价格',
    image_url VARCHAR(500) DEFAULT NULL COMMENT '图片URL',
    dish_id INT DEFAULT NULL COMMENT '关联菜品ID',
    restaurant_id INT DEFAULT NULL COMMENT '关联餐厅ID',
    active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE SET NULL,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL,
    UNIQUE KEY idx_week_day_meal (week_start, day_of_week, meal_type, dish_name, restaurant_name),
    INDEX idx_week_start (week_start),
    INDEX idx_day_meal (day_of_week, meal_type)
) COMMENT = '周菜单表';

-- 每日订单统计表
CREATE TABLE daily_orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_date DATE NOT NULL COMMENT '订单日期',
    meal_type ENUM('lunch', 'dinner') NOT NULL COMMENT '餐次',
    total_people INT DEFAULT 0 COMMENT '总人数',
    no_eat_count INT DEFAULT 0 COMMENT '不用餐人数',
    order_count INT DEFAULT 0 COMMENT '订餐人数',
    status ENUM('open', 'closed', 'confirmed') DEFAULT 'open' COMMENT '状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_date_meal (order_date, meal_type),
    INDEX idx_date (order_date),
    INDEX idx_status (status)
) COMMENT = '每日订单统计表';

-- 不用餐登记表
CREATE TABLE no_eat_registrations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL COMMENT '员工ID',
    employee_name VARCHAR(100) NOT NULL COMMENT '员工姓名',
    registration_date DATE NOT NULL COMMENT '登记日期',
    meal_type ENUM('lunch', 'dinner') NOT NULL COMMENT '餐次',
    reason VARCHAR(500) DEFAULT NULL COMMENT '不用餐原因',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE KEY idx_employee_date_meal (employee_id, registration_date, meal_type),
    INDEX idx_date_meal (registration_date, meal_type),
    INDEX idx_employee (employee_id)
) COMMENT = '不用餐登记表';

-- 菜品评价表
CREATE TABLE ratings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL COMMENT '员工ID',
    employee_name VARCHAR(100) NOT NULL COMMENT '员工姓名',
    dish_id INT NOT NULL COMMENT '菜品ID',
    dish_name VARCHAR(200) NOT NULL COMMENT '菜品名称',
    restaurant_name VARCHAR(200) NOT NULL COMMENT '餐厅名称',
    meal_type ENUM('lunch', 'dinner') NOT NULL COMMENT '餐次',
    rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5) COMMENT '评分1-5',
    comment TEXT COMMENT '评价内容',
    rating_date DATE NOT NULL COMMENT '评价日期',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE,
    UNIQUE KEY idx_employee_dish_date (employee_id, dish_id, rating_date),
    INDEX idx_dish_date (dish_id, rating_date),
    INDEX idx_rating_date (rating_date),
    INDEX idx_employee (employee_id)
) COMMENT = '菜品评价表';

-- 餐厅投稿表
CREATE TABLE restaurant_suggestions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL COMMENT '投稿员工ID',
    employee_name VARCHAR(100) NOT NULL COMMENT '员工姓名',
    restaurant_name VARCHAR(200) NOT NULL COMMENT '餐厅名称',
    reason TEXT NOT NULL COMMENT '推荐理由',
    image_url VARCHAR(500) DEFAULT NULL COMMENT '图片URL',
    votes INT DEFAULT 0 COMMENT '点赞数',
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending' COMMENT '状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    INDEX idx_employee (employee_id),
    INDEX idx_status (status),
    INDEX idx_votes (votes),
    INDEX idx_created_at (created_at)
) COMMENT = '餐厅投稿表';

-- 投稿投票表
CREATE TABLE suggestion_votes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    suggestion_id INT NOT NULL COMMENT '投稿ID',
    employee_id INT NOT NULL COMMENT '投票员工ID',
    employee_name VARCHAR(100) NOT NULL COMMENT '员工姓名',
    vote_type ENUM('up', 'down') DEFAULT 'up' COMMENT '投票类型',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (suggestion_id) REFERENCES restaurant_suggestions(id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE KEY idx_suggestion_employee (suggestion_id, employee_id),
    INDEX idx_suggestion (suggestion_id),
    INDEX idx_employee (employee_id)
) COMMENT = '投稿投票表';

-- 系统设置表
CREATE TABLE settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) NOT NULL UNIQUE COMMENT '设置键',
    setting_value TEXT COMMENT '设置值',
    description VARCHAR(500) COMMENT '设置描述',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key (setting_key)
) COMMENT = '系统设置表';

-- 插入默认设置
INSERT INTO settings (setting_key, setting_value, description) VALUES
('lunch_deadline', '11:00', '午餐登记截止时间'),
('dinner_deadline', '17:00', '晚餐登记截止时间'),
('system_name', '公司订餐系统', '系统名称'),
('max_rating', '5', '最大评分'),
('default_page_size', '20', '默认分页大小');

-- 创建视图：今日菜单
CREATE VIEW v_today_menu AS
SELECT 
    wm.*,
    d.rating as dish_rating,
    d.id as actual_dish_id
FROM weekly_menus wm
LEFT JOIN dishes d ON wm.dish_id = d.id
WHERE wm.week_start = DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
  AND wm.day_of_week = WEEKDAY(CURDATE()) + 1
  AND wm.active = TRUE
ORDER BY wm.meal_type, wm.restaurant_name;

-- 创建视图：菜品评分统计
CREATE VIEW v_dish_ratings AS
SELECT 
    d.id,
    d.name,
    d.restaurant_id,
    r.name as restaurant_name,
    AVG(rt.rating) as avg_rating,
    COUNT(rt.id) as rating_count,
    MAX(rt.created_at) as last_rated
FROM dishes d
LEFT JOIN restaurants r ON d.restaurant_id = r.id
LEFT JOIN ratings rt ON d.id = rt.dish_id
GROUP BY d.id, d.name, d.restaurant_id, r.name;

-- 创建触发器：更新菜品平均评分
DELIMITER $$
CREATE TRIGGER update_dish_rating_after_insert
AFTER INSERT ON ratings
FOR EACH ROW
BEGIN
    UPDATE dishes 
    SET rating = (
        SELECT AVG(rating) 
        FROM ratings 
        WHERE dish_id = NEW.dish_id
    )
    WHERE id = NEW.dish_id;
END$$

CREATE TRIGGER update_dish_rating_after_update
AFTER UPDATE ON ratings
FOR EACH ROW
BEGIN
    UPDATE dishes 
    SET rating = (
        SELECT AVG(rating) 
        FROM ratings 
        WHERE dish_id = NEW.dish_id
    )
    WHERE id = NEW.dish_id;
END$$

CREATE TRIGGER update_dish_rating_after_delete
AFTER DELETE ON ratings
FOR EACH ROW
BEGIN
    UPDATE dishes 
    SET rating = COALESCE((
        SELECT AVG(rating) 
        FROM ratings 
        WHERE dish_id = OLD.dish_id
    ), 0)
    WHERE id = OLD.dish_id;
END$$

-- 创建触发器：更新投稿点赞数
CREATE TRIGGER update_suggestion_votes_after_insert
AFTER INSERT ON suggestion_votes
FOR EACH ROW
BEGIN
    UPDATE restaurant_suggestions 
    SET votes = (
        SELECT COUNT(*) 
        FROM suggestion_votes 
        WHERE suggestion_id = NEW.suggestion_id AND vote_type = 'up'
    )
    WHERE id = NEW.suggestion_id;
END$$

CREATE TRIGGER update_suggestion_votes_after_delete
AFTER DELETE ON suggestion_votes
FOR EACH ROW
BEGIN
    UPDATE restaurant_suggestions 
    SET votes = (
        SELECT COUNT(*) 
        FROM suggestion_votes 
        WHERE suggestion_id = OLD.suggestion_id AND vote_type = 'up'
    )
    WHERE id = OLD.suggestion_id;
END$$

DELIMITER ;