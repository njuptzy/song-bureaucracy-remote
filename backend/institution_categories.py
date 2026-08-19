"""Classify institutions into the five categories used by the design visualization."""

from collections.abc import Iterable


CATEGORY_NAMES = (
    "内廷机构",
    "中央机构",
    "路级机构",
    "州县机构",
    "军队机构",
)

CENTRAL_GROUP_NAMES = (
    "宰辅与决策中枢",
    "三省六部与馆阁",
    "礼仪宗室与宫廷事务",
    "财赋农政与马政",
    "五监与工程教育",
    "司法监察",
    "寺监制度统称",
)

INSTITUTION_GROUP_NAMES = {
    "中央机构": CENTRAL_GROUP_NAMES,
    "内廷机构": (
        "皇帝后妃与宫中省司",
        "东宫公主与宗室府第",
        "学士经筵与翰林供奉",
        "宦官内侍与皇城侍奉",
        "御前供奉与宫廷库务",
    ),
    "路级机构": (
        "转运发运",
        "提点刑狱",
        "提举常平",
        "场务市舶与专卖",
        "安抚与经总制",
        "保甲学事与察访",
        "买马监牧",
    ),
    "州县机构": (
        "京府与留守",
        "州府军监",
        "幕职与诸曹",
        "州学与书院",
        "县镇与监当",
        "邮传驿置",
    ),
    "军队机构": (
        "禁军三衙与环卫",
        "元帅府与都督府",
        "都部署钤辖与巡检",
        "制置招讨与经略安抚",
        "宣抚总领与御前诸军",
        "军马与兽医指挥",
        "城关堡寨与地方防务",
        "将司",
    ),
}

_GROUP_CATALOG_SECTIONS = {
    "内廷机构": {
        "皇帝后妃与宫中省司": ("一、皇帝门", "二、后妃门", "三、尚书内省门"),
        "东宫公主与宗室府第": (
            "四、皇太子与东宫官门",
            "五、公主与驸马都尉门",
            "六、亲王府与王府官门",
        ),
        "学士经筵与翰林供奉": ("七、学士院门", "八、经筵官门", "十、翰林院等供奉机构门"),
        "宦官内侍与皇城侍奉": ("九、宦官门", "二、皇城司与横行五司门"),
        "御前供奉与宫廷库务": (
            "五、宣徽院门",
            "五、殿中省门",
            "二、太常寺门",
            "四、光禄寺门",
            "五、卫尉寺门",
            "六、太仆寺门",
            "九、太府寺门",
        ),
    },
    "路级机构": {
        "转运发运": ("一、总监司门", "二、发运使、转运使门"),
        "提点刑狱": ("三、提点刑狱公事门",),
        "提举常平": ("四、提举常平公事门",),
        "场务市舶与专卖": ("五、监、冶、场、务门", "六、市舶司门"),
        "安抚与经总制": ("七、安抚使、经总制司门",),
        "保甲学事与察访": ("八、提举保甲司、学事司、察访司等路机构门",),
        "买马监牧": (),
    },
    "州县机构": {
        "京府与留守": ("一、京府、次府、留守司门",),
        "州府军监": ("二、州、府、军、监门",),
        "幕职与诸曹": ("三、幕职官与诸曹官门",),
        "州学与书院": ("四、州府学与书院门",),
        "县镇与监当": ("五、县镇官与监当官门",),
        "邮传驿置": ("[附]邮置",),
    },
    "军队机构": {
        "禁军三衙与环卫": ("一、禁军三衙门", "三、三卫官与六统军门", "[附]环卫官门"),
        "元帅府与都督府": ("一、大元帅府、都督府门",),
        "都部署钤辖与巡检": ("二、兵马都部署、钤辖、监押与巡检门",),
        "制置招讨与经略安抚": ("三、制置、宣谕、招讨、经略安抚使门",),
        "宣抚总领与御前诸军": ("四、宣抚司、总领所门", "五、御前诸军都统制司门"),
        "军马与兽医指挥": (),
        "城关堡寨与地方防务": (),
        "将司": ("六、将司门",),
    },
}

_GROUP_ATTRIBUTE_MARKERS = {
    "内廷机构": {
        "皇帝后妃与宫中省司": (
            "皇帝",
            "后妃",
            "尚书内省",
            "宫中省司",
            # 德寿宫、重华宫等太上皇宫殿，不与中央礼仪宫观混分。
            "宫殿",
        ),
        "东宫公主与宗室府第": ("东宫", "皇太子", "公主", "亲王府", "王府"),
        "学士经筵与翰林供奉": ("学士院", "经筵", "翰林", "供奉"),
        "宦官内侍与皇城侍奉": ("宦官", "内侍", "皇城司", "横行"),
        "御前供奉与宫廷库务": (
            "宫廷",
            "御前",
            "内庭",
            "御宝",
            "宣徽",
            "殿中省",
        ),
    },
    "路级机构": {
        "转运发运": ("转运", "发运", "漕运"),
        "提点刑狱": ("提点刑狱", "提刑"),
        "提举常平": ("常平",),
        "场务市舶与专卖": (
            "市舶",
            "坑冶",
            "场务",
            "税务",
            "度量衡",
            "茶场",
            "市易",
            "交子",
            "纸币",
        ),
        "安抚与经总制": ("安抚", "经总制"),
        "保甲学事与察访": ("保甲", "学事", "察访"),
        "买马监牧": ("买马", "监牧"),
    },
    "州县机构": {
        "京府与留守": ("京府", "留守司"),
        "州府军监": ("州府", "府州", "州县行政"),
        "幕职与诸曹": ("幕职", "诸曹"),
        "州学与书院": ("州学", "府学", "书院"),
        "县镇与监当": ("县镇", "监当"),
        "邮传驿置": ("邮置", "驿传", "递铺"),
    },
    "军队机构": {
        "禁军三衙与环卫": ("禁军", "三衙", "环卫", "三卫", "六统军"),
        "元帅府与都督府": ("大元帅府", "元帅府", "都督府"),
        "都部署钤辖与巡检": ("都部署", "钤辖", "监押", "巡检"),
        "制置招讨与经略安抚": ("制置", "宣谕", "招讨", "经略安抚"),
        "宣抚总领与御前诸军": (
            "宣抚",
            "总领所",
            "御前诸军",
            "都统制司",
            "御营使司",
            "御营宿卫",
        ),
        "军马与兽医指挥": ("监牧指挥", "兽医指挥", "牧马军"),
        "城关堡寨与地方防务": ("地方/军事设施", "城", "关", "堡", "寨"),
        "将司": ("将司",),
    },
}

_ATTRIBUTE_MARKERS = {
    "州县机构": ("州府", "州县", "县级", "地方行政单位"),
    # “路”只按明确的行政层级措辞识别，避免把“京师道路机构”误判为路级。
    "路级机构": ("路级",),
    "军队机构": ("军事", "军队", "禁军", "军号", "统兵", "军实例", "军编制"),
    "内廷机构": (
        "内廷",
        "内庭",
        "宫廷",
        "宫中",
        "宫内",
        "宫禁",
        "内侍",
        "东宫",
        "后宫",
        "御前",
        "尚书内省",
        # 德寿宫、重华宫等太上皇宫殿，明确的内廷空间。
        "宫殿",
    ),
    # 玉清昭应宫、景灵宫等宫观是朝廷礼仪性宗教机构，归中央礼仪系统；
    # 与祠禄官（第十二编）的差遣性质区分开。
    "中央机构": ("中央", "中枢", "宫观"),
}

# 标题兜底标记：仅当时间点类别与辞典目录都无法判定时启用。
# 规则按类别顺序匹配，命中即返回，判定依据会标注"标题推断（兜底）"。
_TITLE_FALLBACK_RULES = (
    ("军队机构", ("宣抚",)),
    ("中央机构", ("八作司", "榷易院")),
)
# “某府”默认是州府级行政单位（州县机构），但下列例外不是。
_TITLE_FU_EXCLUSIONS = ("都督府", "元帅府", "王府", "都护府", "折冲府")


def _title_fallback_category(title: str) -> str | None:
    for category, markers in _TITLE_FALLBACK_RULES:
        if any(marker in title for marker in markers):
            return category
    if title.endswith("府") and not title.endswith(_TITLE_FU_EXCLUSIONS):
        return "州县机构"
    return None

_CHAPTER_CATEGORIES = {
    "第一编": "内廷机构",
    "第二编": "中央机构",
    "第三编": "中央机构",
    "第四编": "中央机构",
    "第五编": "中央机构",
    "第六编": "中央机构",
    "第八编": "军队机构",
    "第九编": "路级机构",
    "第十编": "州县机构",
}

_CHAPTER_SEVEN_MILITARY_SECTIONS = (
    "禁军三衙门",
    "三卫官与六统军门",
    "环卫官门",
)

_NON_CENTRAL_PRIORITY = ("州县机构", "路级机构", "军队机构", "内廷机构")


def _attribute_candidates(attr_categories: Iterable[str]) -> set[str]:
    attrs = " ".join(item for item in attr_categories if item)
    return {
        category
        for category, markers in _ATTRIBUTE_MARKERS.items()
        if any(marker in attrs for marker in markers)
    }


def _catalog_category(catalog: str) -> str | None:
    if "第七编 皇宫京城禁卫侍奉机构类" in catalog:
        if any(section in catalog for section in _CHAPTER_SEVEN_MILITARY_SECTIONS):
            return "军队机构"
        return "内廷机构"
    for chapter, category in _CHAPTER_CATEGORIES.items():
        if chapter in catalog:
            return category
    return None


def catalog_categories(source_catalogs: Iterable[str]) -> set[str]:
    return {
        category
        for catalog in source_catalogs
        if catalog and (category := _catalog_category(catalog))
    }


def resolve_source_catalogs(
    entity_title: str,
    source_refs: Iterable[tuple[str, str]],
    catalogs_by_reference,
    catalogs_by_page,
    catalogs_by_title,
) -> set[str]:
    """Resolve catalogs without letting ambiguous title fallback pollute precise evidence."""
    headword_catalogs = set()
    precise_catalogs = set()
    fallback_catalogs = set()

    for source_entry, source_page in source_refs:
        exact = catalogs_by_reference.get((source_entry, source_page), set())
        catalogs = exact
        if not catalogs and source_page:
            catalogs = catalogs_by_page.get(source_page, set())
        if catalogs:
            precise_catalogs.update(catalogs)
            if exact and source_entry == entity_title:
                headword_catalogs.update(catalogs)
        elif source_entry:
            fallback_catalogs.update(catalogs_by_title.get(source_entry, set()))

    # The entity's own formal dictionary headword is stronger than incidental
    # mentions in other entries. If no own headword exists, page evidence is
    # still stronger than a page-less same-title fallback.
    return headword_catalogs or precise_catalogs or fallback_catalogs


def resolve_source_order(
    entity_title: str,
    source_refs: Iterable[tuple[str, str]],
    orders_by_reference,
    orders_by_page,
    orders_by_title,
) -> tuple[int | None, str]:
    """Resolve an institution's first dictionary position from provenance."""
    headword_orders = set()
    precise_orders = set()
    fallback_orders = set()

    for source_entry, source_page in source_refs:
        exact = set(orders_by_reference.get((source_entry, source_page), ()))
        if exact:
            precise_orders.update(exact)
            if source_entry == entity_title:
                headword_orders.update(exact)
            continue

        # Title/page-only evidence is used only when it identifies one entry.
        # A page commonly contains several dictionary entries, so choosing the
        # first item from an ambiguous page would fabricate an order.
        title_orders = set(orders_by_title.get(source_entry, ())) if source_entry else set()
        page_orders = set(orders_by_page.get(source_page, ())) if source_page else set()
        if len(title_orders) == 1 and len(page_orders) == 1 and title_orders != page_orders:
            continue
        if len(title_orders) == 1:
            fallback_orders.update(title_orders)
        if len(page_orders) == 1:
            fallback_orders.update(page_orders)

    if headword_orders:
        return min(headword_orders), "辞典正式词头与页码精确匹配"
    if precise_orders:
        return min(precise_orders), "BuildRecords 词条与页码精确匹配"

    formal_headword_orders = set(orders_by_title.get(entity_title, ()))
    if len(formal_headword_orders) == 1:
        return next(iter(formal_headword_orders)), "辞典正式词头唯一匹配"
    if fallback_orders:
        return min(fallback_orders), "BuildRecords 标题或页码唯一回退"
    return None, "未匹配到可靠辞典顺序"


def classify_institution(
    attr_categories: Iterable[str], source_catalogs: Iterable[str], title: str = ""
) -> tuple[str | None, str]:
    """Return a design category and an auditable classification basis."""
    attr_candidates = _attribute_candidates(attr_categories)
    catalog_candidates = catalog_categories(source_catalogs)

    agreement = attr_candidates & catalog_candidates
    if len(agreement) == 1:
        return agreement.pop(), "时间点类别与辞典目录一致"
    if len(attr_candidates) == 1:
        return attr_candidates.pop(), "时间点类别"
    if len(catalog_candidates) == 1:
        return catalog_candidates.pop(), "辞典目录"

    # Cross-chapter entities often combine a central predecessor or supervisor
    # with one more specific institutional setting. Do not let the broad
    # central bucket absorb that explicit non-central evidence.
    non_central = catalog_candidates - {"中央机构"}
    if len(non_central) == 1:
        return non_central.pop(), "跨编辞典目录（采用具体非中央类别）"

    candidates = agreement or attr_candidates or catalog_candidates
    for category in _NON_CENTRAL_PRIORITY:
        if category in candidates:
            return category, "多重分类证据（按具体类别优先级）"
    if "中央机构" in candidates:
        return "中央机构", "中央机构明确证据"
    fallback = _title_fallback_category(title)
    if fallback:
        return fallback, "标题推断（兜底）"
    return None, "缺少可判定的分类证据"


def classify_central_group(
    title: str, attr_categories: Iterable[str], source_catalogs: Iterable[str]
) -> tuple[str | None, str]:
    """Classify a central institution by the dictionary's institutional system."""
    catalogs = " ".join(item for item in source_catalogs if item)
    attrs = " ".join(item for item in attr_categories if item)
    title_and_attrs = f"{title} {attrs}"

    # 宫观是朝廷礼仪性宗教机构；这里依据明确的“宫观”类别判定，
    # 不以标题中泛化的“宫”字推断，以免与德寿宫、重华宫等宫殿混淆。
    if "宫观" in attrs:
        return "礼仪宗室与宫廷事务", "时间点类别明确为中央礼仪宫观"

    formal_systems = {
        "礼仪宗室与宫廷事务": {"太常寺", "宗正寺", "光禄寺", "卫尉寺", "鸿胪寺"},
        "财赋农政与马政": {"太仆寺", "司农寺", "太府寺"},
        "五监与工程教育": {"秘书监", "国子监", "少府监", "军器监", "将作监", "都水监"},
        "司法监察": {"大理寺"},
        "寺监制度统称": {"九寺五监", "九寺三监", "七寺"},
    }
    for group, titles in formal_systems.items():
        if title in titles:
            basis = "寺监制度统称" if group == "寺监制度统称" else "正式寺监制度归属"
            return group, basis

    # 辞典分门是检索编排，不等于下属机构都具有门名机构的决策职能。
    # 皮剥所一系虽列在枢密院门，原文仍明确其为马政监当局，并曾隶太仆寺、驾部。
    if any(marker in title_and_attrs for marker in ("马政", "马务", "剥马", "皮剥所")):
        return "财赋农政与马政", "实体名称或类别明确属于马政监当体系"

    if "第六编 司法、监察机构类" in catalogs or any(
        marker in attrs for marker in ("司法机构", "监察机构", "谏官机构")
    ):
        return "司法监察", "辞典司法监察编目或明确类别"

    if (
        "第四编 元丰正名后中枢机构类之一" in catalogs
        or "殿阁学士与三馆秘阁门" in catalogs
    ):
        return "三省六部与馆阁", "辞典三省六部或馆阁编目"

    if "第五编" in catalogs:
        section_groups = {
            "礼仪宗室与宫廷事务": (
                "二、太常寺门",
                "三、宗正寺大宗正司门",
                "四、光禄寺门",
                "五、卫尉寺门",
                "七、鸿胪寺门",
            ),
            "财赋农政与马政": ("六、太仆寺门", "八、司农寺门", "九、太府寺门"),
            "五监与工程教育": (
                "十、五监、国子监门",
                "十一、少府监门",
                "十二、军器监门",
                "十三、将作监门",
                "十四、都水监门",
            ),
        }
        for group, sections in section_groups.items():
            if any(section in catalogs for section in sections):
                return group, "辞典寺监分门编目"

        if "一、总九寺五监门" in catalogs:
            if "机构统称" in attrs:
                return "寺监制度统称", "辞典寺监总类与统称类别"
            if any(marker in attrs for marker in ("司法", "大理寺")):
                return "司法监察", "寺监总类中的司法职能"
            if any(marker in attrs for marker in ("财政", "财赋", "农政", "马政")):
                return "财赋农政与马政", "寺监总类中的财赋农马职能"
            if any(marker in attrs for marker in ("教育", "营造", "军器", "水利", "河渠")):
                return "五监与工程教育", "寺监总类中的教育工程职能"
            if any(
                marker in attrs
                for marker in ("礼制", "礼乐", "宗室", "宾客礼仪", "宫廷", "寺监机构")
            ):
                return "礼仪宗室与宫廷事务", "寺监总类中的礼仪宫廷职能"

    if "第三编" in catalogs:
        section_groups = {
            "财赋农政与马政": ("四、三司门", "六、群牧司门"),
            "礼仪宗室与宫廷事务": ("五、宣徽院门",),
            "三省六部与馆阁": ("[附]殿阁学士与三馆秘阁门",),
        }
        for group, sections in section_groups.items():
            if any(section in catalogs for section in sections):
                return group, "辞典北宋前期中枢机构分门"
        return "宰辅与决策中枢", "辞典宰执或北宋前期中枢编目"
    if "第二编" in catalogs:
        return "宰辅与决策中枢", "辞典宰执编目"
    return None, "缺少中央制度分组证据"


def classify_institution_group(
    category: str,
    title: str,
    attr_categories: Iterable[str],
    source_catalogs: Iterable[str],
) -> tuple[str | None, str]:
    """Classify every institution into a stable visual group across all years."""
    if category == "中央机构":
        return classify_central_group(title, attr_categories, source_catalogs)

    catalog_text = " ".join(item for item in source_catalogs if item)
    attr_text = " ".join([title, *(item for item in attr_categories if item)])
    section_groups = _GROUP_CATALOG_SECTIONS.get(category, {})
    catalog_candidates = {
        group
        for group, sections in section_groups.items()
        if any(section in catalog_text for section in sections)
    }
    if len(catalog_candidates) == 1:
        return catalog_candidates.pop(), "辞典分门编目"

    marker_groups = _GROUP_ATTRIBUTE_MARKERS.get(category, {})
    marker_candidates = {
        group
        for group, markers in marker_groups.items()
        if any(marker in attr_text for marker in markers)
    }
    agreement = catalog_candidates & marker_candidates
    if len(agreement) == 1:
        return agreement.pop(), "辞典分门与实体类别一致"
    if len(marker_candidates) == 1:
        return marker_candidates.pop(), "实体名称或时间点明确类别"
    return None, f"缺少{category}制度分组证据"
